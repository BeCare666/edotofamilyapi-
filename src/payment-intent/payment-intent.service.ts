import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.services';
import { Pool, RowDataPacket, ResultSetHeader, PoolConnection } from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { Cron } from '@nestjs/schedule';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { Readable } from 'stream';
import { sendVerificationEmail } from '../auth/mailer';
import { randomInt } from 'crypto';
import { verifyFeexPayForOrder } from './feexpay-verify';
import { buildPickupOtpEmail, PICKUP_OTP_EMAIL_SUBJECT, PICKUP_OTP_TTL_MS } from '../orders/pickup-otp-email';
import { safeError } from '../common/request-log';
import { INVOICE_STORAGE_TYPE } from './invoice-storage';
@Injectable()
export class PaymentIntentService {
  private pool: Pool;
  private readonly logger = new Logger(PaymentIntentService.name);

  constructor(private readonly databaseService: DatabaseService) {
    this.pool = this.databaseService.getPool();
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  // Entrée HTTP de POST /payments/feexpay/complete :
  // seul le client de la commande (ou l'admin) peut la déclencher, une seule fois,
  // et l'OTP n'est jamais renvoyé dans la réponse (il part uniquement par e-mail).
  // Audit 1.1 (29/10/2026) : la transaction est vérifiée auprès de FeexPay (API v2) avant toute écriture.
  async completeFeexPayForUser(
    body: { transaction_id: string; custom_id: string; feexpay_response?: any },
    user: any,
  ) {
    if (!body?.transaction_id || !body?.custom_id) {
      throw new BadRequestException('Invalid payload');
    }
    const [orderRows] = await this.pool.query<RowDataPacket[]>(
      `SELECT id, customer_id, payment_status, total FROM orders WHERE tracking_number = ? LIMIT 1`,
      [body.custom_id]
    );
    const order = orderRows[0];
    if (!order) throw new NotFoundException('Order not found');

    const isAdmin = Array.isArray(user?.permissions) && user.permissions.includes('super_admin');
    if (!isAdmin && Number(order.customer_id) !== Number(user?.id)) {
      throw new ForbiddenException('Accès refusé.');
    }

    // Idempotence : un second appel ne régénère pas d'OTP et ne renvoie pas d'e-mail
    if (order.payment_status === 'payment-success') {
      return { success: true, processed: true, orderId: order.id, alreadyProcessed: true };
    }

    // FeexPay confirme, montant suffisant, transaction jamais utilisée : sinon 402 / 409 / 503, commande inchangée
    const reference = this.feexpayReference(body);
    await verifyFeexPayForOrder(reference, order, (ref) => this.feexpayReferenceUsed(ref));

    const { otp, ...result } = await this.completeFeexPayPayment({ ...body, feexpay_verified_reference: reference }) as any;
    return result;
  }

  /** Référence FeexPay envoyée par le site (callback du SDK v2 : reference ; à défaut transaction_id) */
  private feexpayReference(body: { transaction_id?: string; feexpay_response?: any }): string {
    return String(body?.feexpay_response?.reference || body?.transaction_id || '').trim();
  }

  private async feexpayReferenceUsed(reference: string): Promise<boolean> {
    const [rows] = await this.pool.query<RowDataPacket[]>(`SELECT id FROM payment_intents WHERE feexpay_reference = ? LIMIT 1`, [reference]);
    return rows.length > 0;
  }

  // POST /payments/feexpay/complete
  // service.ts (extrait) - méthode completeFeexPayPayment améliorée
  async completeFeexPayPayment(
    body: { transaction_id: string; custom_id: string; feexpay_response?: any; feexpay_verified_reference?: string },
    externalConn?: PoolConnection
  ) {
    const conn = externalConn ?? await this.pool.getConnection();
    const isExternal = !!externalConn;

    let pendingId = null;

    try {
      const { transaction_id, custom_id, feexpay_response } = body;
      if (!transaction_id || !custom_id) throw new Error("Invalid payload");

      // 0) Trace dans pending_payments — seulement si pas un retry manuel
      if (!isExternal) {
        const [pendingInsert] = await conn.query<ResultSetHeader>(
          `INSERT INTO pending_payments (tracking_number, transaction_id, feexpay_response, status, created_at, updated_at)
         VALUES (?, ?, ?, 'processing', NOW(), NOW())`,
          [custom_id, transaction_id, JSON.stringify(feexpay_response || {})]
        );
        pendingId = pendingInsert.insertId;
      }

      // 1) Begin transaction uniquement si interne
      if (!isExternal) await conn.beginTransaction();

      // 2) Charger commande
      const [orderRows] = await conn.query<RowDataPacket[]>(
        `SELECT * FROM orders WHERE tracking_number=? LIMIT 1`,
        [custom_id]
      );
      const order = orderRows[0];
      if (!order) throw new Error("Order not found");

      // Audit 1.1 : jamais de commande payée sans vérification FeexPay (relance automatique comprise)
      let feexpayReference = body.feexpay_verified_reference;
      if (!feexpayReference) {
        feexpayReference = this.feexpayReference(body);
        await verifyFeexPayForOrder(feexpayReference, order, (ref) => this.feexpayReferenceUsed(ref));
      }

      const orderId = order.id;
      const amount = order.total;
      const currency = order.currency ?? "XOF";

      // 3) payment_intent
      const tx_ref = `FPX-${orderId}-${Date.now()}`;
      const [insert] = await conn.query<ResultSetHeader>(
        `INSERT INTO payment_intents
       (order_id, tracking_number, payment_gateway, status, total_amount, currency, payment_intent_info, feexpay_reference, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          orderId,
          order.tracking_number,
          "feexpay",
          "payment-success",
          amount,
          currency,
          JSON.stringify({ tx_ref, transaction_id, custom_id }),
          feexpayReference || null,
        ]
      );
      const paymentIntentId = insert.insertId;

      // 4) OTP
      const otp = randomInt(100000, 1000000).toString();
      const expiresAt = new Date(Date.now() + PICKUP_OTP_TTL_MS);
      await conn.query(
        `UPDATE orders SET otp_code=?, otp_used=0, otp_attempts=0, otp_expires_at=?, updated_at=NOW() WHERE id=?`,
        [otp, expiresAt, orderId]
      );

      // 5) Récup email
      const [userRows] = await conn.query<RowDataPacket[]>(
        `SELECT email FROM users WHERE id=? LIMIT 1`,
        [order.customer_id]
      );
      if (!userRows[0]) throw new Error("Customer not found");
      const customer = userRows[0];

      // 6) Email
      try {
        // 5️⃣ Envoyer l’email avec OTP
        await sendVerificationEmail({
          email: customer.email,
          subject: PICKUP_OTP_EMAIL_SUBJECT,
          message: buildPickupOtpEmail(order.tracking_number, otp),
        });
      } catch (e) {
        throw new Error("Failed to send OTP email: " + e);
      }

      // 7) commande + enfants
      await conn.query(
        `UPDATE orders SET order_status='order-processing', payment_status='payment-success', updated_at=NOW() WHERE id=?`,
        [orderId]
      );
      await conn.query(
        `UPDATE order_children SET order_status='order-processing', payment_status='payment-success', updated_at=NOW() WHERE order_id=?`,
        [orderId]
      );

      // 8) updates
      await this.updateWallets(orderId, conn);
      await this.updateAnalytics(amount, conn);
      await this.generateInvoices(orderId, conn);

      // 9) commit uniquement si interne
      if (!isExternal) await conn.commit();

      // 10) maj pending_payments
      if (!isExternal) {
        await conn.query(
          `UPDATE pending_payments SET status='completed', processed_at=NOW(), payment_intent_id=?, updated_at=NOW() WHERE id=?`,
          [paymentIntentId, pendingId]
        );
      }

      return {
        success: true,
        processed: true,
        orderId,
        paymentIntentId,
        tx_ref,
        otp,
        pendingPaymentId: pendingId
      };

    } catch (err: any) {

      if (!isExternal) {
        try { await conn.rollback(); } catch { }
        await conn.query(
          `UPDATE pending_payments SET status='failed', error_message=?, updated_at=NOW() WHERE id=?`,
          [String(err.message || err), pendingId]
        );
      }

      return {
        success: true,
        processed: false,
        pendingPaymentId: pendingId,
        error: String(err.message || err)
      };

    } finally {
      if (!isExternal) conn.release();
    }
  }








  // ---------------------------
  // Mise à jour wallets
  private async updateWallets(orderId: number, conn: any) {
    // Commence une transaction SQL
    await conn.beginTransaction();

    try {
      // 🔹 Récupérer les commandes enfants
      const [rows] = await conn.query(
        `SELECT co.*, s.owner_id 
       FROM order_children co
       JOIN shops s ON s.id = co.shop_id
       WHERE co.order_id = ?`,
        [orderId]
      );

      const childOrders = rows as RowDataPacket[];

      for (const co of childOrders) {
        const amount = co.subtotal;

        try {
          // 💰 Mise à jour wallet du shop
          const [updateResult]: any = await conn.query(
            `UPDATE shops 
           SET wallet_balance = wallet_balance + ? 
           WHERE id = ?`,
            [amount, co.shop_id]
          );

          if (updateResult.affectedRows === 0) {
            // 🚨 Shop introuvable → log en failed
            await conn.query(
              `INSERT INTO wallet_transactions (shop_id, order_id, amount, type, status)
             VALUES (?, ?, ?, 'credit', 'failed')`,
              [co.shop_id, orderId, amount]
            );
            throw new Error(`Wallet update failed for shop ${co.shop_id}`);
          }

          // ✅ Insert succès
          await conn.query(
            `INSERT INTO wallet_transactions (shop_id, order_id, amount, type, status)
           VALUES (?, ?, ?, 'credit', 'success')`,
            [co.shop_id, orderId, amount]
          );
        } catch (innerErr) {
          // ⛔ Si une erreur survient pour ce shop → log failed
          await conn.query(
            `INSERT INTO wallet_transactions (shop_id, order_id, amount, type, status)
           VALUES (?, ?, ?, 'credit', 'failed')`,
            [co.shop_id, orderId, co.subtotal]
          );
          throw innerErr;
        }
      }

      // ✅ Valide tout
      await conn.commit();
    } catch (err) {
      // ❌ Rollback global si un problème survient
      await conn.rollback();
      throw err;
    }
  }


  // ---------------------------
  // Mise à jour analytics
  // ---------------------------
  private async updateAnalytics(amount: number, conn: PoolConnection) {
    const [rows] = await conn.query<RowDataPacket[]>(`SELECT * FROM analytics WHERE id = 1`);

    if (rows.length === 0) {
      await conn.query<ResultSetHeader>(
        `INSERT INTO analytics (totalRevenue, totalOrders, created_at) VALUES (?, ?, NOW())`,
        [amount, 1]
      );
    } else {
      await conn.query<ResultSetHeader>(
        `UPDATE analytics SET totalRevenue = totalRevenue + ?, totalOrders = totalOrders + 1, updated_at = NOW() WHERE id = 1`,
        [amount]
      );
    }
  }


  // ---------------------------
  // Génération factures (shops + client)
  // ---------------------------

  // ---------------------------
  // Génération PDF et upload Cloudinary
  // ---------------------------
  private async buildInvoicePdfBuffer(
    order: any,
    user: any,
    items: any[],
    title: string
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const buffers: Buffer[] = [];
      const doc = new PDFDocument({ size: 'A4', margin: 50 });

      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      // --- Couleurs et style
      const primaryColor = '#EA9453'; // couleur principale GalileeCommerce
      const textColor = '#333';
      const tableHeaderBg = '#F4F4F4';
      const logoPath = path.join(__dirname, '../../assets/logo.png'); // logo local ou Cloudinary

      // --- Logo
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 50, 45, { width: 120 });
      }

      // --- Titre facture
      doc.fillColor(primaryColor)
        .fontSize(22)
        .text(title, 0, 50, { align: 'right' });

      doc.moveDown(3);

      // --- Infos client et commande
      doc.fillColor(textColor)
        .fontSize(12)
        .text(`Order: ${order.tracking_number}`)
        .text(`Client: ${user.name} (${user.email})`)
        .text(`Date: ${new Date(order.created_at).toLocaleDateString()}`)
        .moveDown();

      // --- Table des produits
      const tableTop = doc.y + 10;
      const itemSpacing = 20;

      // Table header
      doc.fillColor('#fff')
        .rect(50, tableTop, 500, 25)
        .fill(primaryColor)
        .stroke();

      doc.fillColor('#fff')
        .fontSize(10)
        .text('Shop', 55, tableTop + 7)
        .text('Product', 150, tableTop + 7)
        .text('Quantity', 300, tableTop + 7, { width: 50, align: 'right' })
        .text('Unit Price', 370, tableTop + 7, { width: 70, align: 'right' })
        .text('Subtotal', 450, tableTop + 7, { width: 100, align: 'right' });

      // Table rows
      let y = tableTop + 25;
      items.forEach((co) => {
        doc.fillColor(textColor)
          .fontSize(10)
          .text(co.shop_name, 55, y)
          .text(co.product_name, 150, y)
          .text(co.order_quantity, 300, y, { width: 50, align: 'right' })
          .text(`${co.unit_price} $`, 370, y, { width: 70, align: 'right' })
          .text(`${co.subtotal} $`, 450, y, { width: 100, align: 'right' });

        y += itemSpacing;
      });

      // --- Total
      doc.fontSize(12)
        .fillColor(textColor)
        .text(`Total: ${order.total} $`, 400, y + 20, { align: 'right' });

      // --- Footer
      doc.fontSize(10)
        .fillColor('#999')
        .text('Thank you for your purchase!', 50, 750, { align: 'center', width: 500 });

      doc.end();
    });
  }


  private async uploadPdfToCloudinary(buffer: Buffer, publicId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        // Audit sécurité 2.8 : accès restreint, lisible seulement par un lien signé de l'API
        { resource_type: 'raw', public_id: publicId, type: INVOICE_STORAGE_TYPE },
        (error, result) => {
          if (error) return reject(error);
          resolve(result?.secure_url || '');
        },
      );
      uploadStream.end(buffer);
    });
  }

  // ---------------------------
  // Fonction principale generateInvoices
  // ---------------------------
  public async generateInvoices(orderId: number, conn: PoolConnection): Promise<void> {
    const [orderRows] = await conn.query<RowDataPacket[]>(`SELECT * FROM orders WHERE id = ?`, [orderId]);
    const order = orderRows[0];
    if (!order) throw new Error(`Order ${orderId} not found`);

    const [userRows] = await conn.query<RowDataPacket[]>(`SELECT * FROM users WHERE id = ?`, [order.customer_id]);
    const user = userRows[0];

    const [childOrders] = await conn.query<RowDataPacket[]>(`
    SELECT co.id as child_order_id,
           co.order_quantity,
           co.unit_price,
           co.subtotal,
           s.name as shop_name,
           co.shop_id,
           s.contact as shop_contact,
           p.name as product_name
    FROM order_children co
    JOIN shops s ON s.id = co.shop_id
    JOIN products p ON p.id = co.product_id
    WHERE co.order_id = ?`, [orderId]
    );

    // 1️⃣ Facture client
    const clientBuffer = await this.buildInvoicePdfBuffer(order, user, childOrders, 'Client Invoice');
    const clientUrl = await this.uploadPdfToCloudinary(clientBuffer, `invoice_client_${order.tracking_number}`);
    await conn.query<ResultSetHeader>(
      `INSERT INTO invoices (order_id, pdf_url, type, status) VALUES (?, ?, 'client', 'generated')`,
      [orderId, clientUrl],
    );

    // 2️⃣ Factures shops
    for (const co of childOrders) {
      const shopBuffer = await this.buildInvoicePdfBuffer(order, user, [co], `Invoice for ${co.shop_name}`);
      const shopUrl = await this.uploadPdfToCloudinary(shopBuffer, `invoice_shop_${co.shop_id}_${order.tracking_number}`);
      await conn.query<ResultSetHeader>(
        `INSERT INTO invoices (order_id, shop_id, pdf_url, type, status) VALUES (?, ?, ?, 'shop', 'generated')`,
        [orderId, co.shop_id, shopUrl],
      );
    }

    this.logger.debug(`Factures générées et uploadées pour order ${order.tracking_number}`);
  }


  // ---------------------------
  // Cron : regénère factures manquantes
  // ---------------------------
  @Cron('* * * * *') // chaque minute
  async regenerateFailedInvoices() {
    this.logger.debug('Cron: vérification des factures manquantes...');
    const [orders] = await this.pool.query<RowDataPacket[]>(
      `SELECT o.id, o.tracking_number
       FROM orders o
       JOIN payment_intents pi ON pi.order_id = o.id
       WHERE pi.status = 'payment-success'
       AND NOT EXISTS (SELECT 1 FROM invoices WHERE order_id = o.id)`
    );

    for (const order of orders) {
      const conn = await this.pool.getConnection(); // ⚡ connexion transactionnelle
      try {
        this.logger.debug(`Regénération facture pour commande ${order.tracking_number}`);
        await this.generateInvoices(order.id, conn);
      } catch (err) {
        this.logger.error(`Erreur génération facture commande ${order.tracking_number}`, safeError(err));
      }
    }
  }

  // retryPendingPayments supprimée (30/10/2026) : aucune planification ni aucun appel, elle lisait des colonnes
  // inexistantes (custom_id, raw_response) et écrivait un statut hors ENUM ('processed'). Les paiements non aboutis
  // apparaissent dans l'admin, Transactions (B6), pour vérification dans FeexPay.



}

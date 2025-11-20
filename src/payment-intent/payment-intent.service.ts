import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.services';
import { Pool, RowDataPacket, ResultSetHeader, PoolConnection } from 'mysql2/promise';
import axios, { AxiosError } from 'axios';
import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { Cron } from '@nestjs/schedule';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { Readable } from 'stream';
import { sendVerificationEmail } from '../auth/mailer';
interface FlutterwavePaymentData {
  id: number;
  tx_ref: string;
  amount: number;
  currency: string;
  status: string;
  customer: { id: number; name: string; email: string; phone_number?: string };
  payment_type: string;
  created_at: string;
  [key: string]: any;
}
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dxug9vkcd',
  api_key: process.env.CLOUDINARY_API_KEY || '157518177599353',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'in7j-BzRT8z_nCHWQ1JXpDuYhfU',
});
@Injectable()
export class PaymentIntentService {
  private pool: Pool;
  private readonly logger = new Logger(PaymentIntentService.name);

  constructor(private readonly databaseService: DatabaseService) {
    this.pool = this.databaseService.getPool();
  }

  // ---------------------------
  // Crée un payment intent
  // ---------------------------
  async createPaymentIntent(orderId: number, paymentGateway: string) {
    const [orderRows] = await this.pool.query<RowDataPacket[]>(
      `SELECT * FROM orders WHERE id = ?`,
      [orderId]
    );
    const order = orderRows[0];
    if (!order) throw new Error('Order not found');

    const [existingIntentRows] = await this.pool.query<RowDataPacket[]>(
      `SELECT * FROM payment_intents WHERE order_id = ? AND status IN ('payment-pending', 'payment-processing')`,
      [orderId]
    );
    if (existingIntentRows.length > 0) {
      return existingIntentRows[0];
    }

    const tx_ref = `FLW-${order.id}-${Date.now()}`;
    const public_key = process.env.FLUTTERWAVE_PUBLIC_KEY;

    const [result] = await this.pool.query<ResultSetHeader>(
      `INSERT INTO payment_intents
      (order_id, tracking_number, payment_gateway, status, total_amount, currency, payment_intent_info)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        order.id,
        order.tracking_number,
        paymentGateway,
        'payment-pending',
        order.total,
        order.currency || 'USD',
        JSON.stringify({ tx_ref }),
      ]
    );

    const paymentIntentInfo = {
      tx_ref,
      amount: order.total,
      currency: order.currency || 'USD',
      customer_email: order.customer_email || 'example@example.com',
      customer_name: order.customer_name || 'Client',
      customer_phone: order.customer_contact || '',
      public_key,
      title: 'Order Payment',
      description: `Payment for order ${order.tracking_number}`,
      is_redirect: false,
      redirect_url: null,
    };

    await this.pool.query<ResultSetHeader>(
      `UPDATE payment_intents SET payment_intent_info = ? WHERE id = ?`,
      [JSON.stringify(paymentIntentInfo), result.insertId]
    );

    return {
      id: result.insertId,
      tracking_number: order.tracking_number,
      total_amount: order.total,
      currency: order.currency || 'USD',
      payment_gateway: paymentGateway,
      tx_ref,
      payment_intent_info: paymentIntentInfo,
    };
  }
  // POST /payments/feexpay/complete
  // service.ts (extrait) - méthode completeFeexPayPayment améliorée
  async completeFeexPayPayment(
    body: { transaction_id: string; custom_id: string; feexpay_response?: any; },
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

      const orderId = order.id;
      const amount = order.total;
      const currency = order.currency ?? "XOF";

      // 3) payment_intent
      const tx_ref = `FPX-${orderId}-${Date.now()}`;
      const [insert] = await conn.query<ResultSetHeader>(
        `INSERT INTO payment_intents
       (order_id, tracking_number, payment_gateway, status, total_amount, currency, payment_intent_info, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          orderId,
          order.tracking_number,
          "feexpay",
          "payment-success",
          amount,
          currency,
          JSON.stringify({ tx_ref, transaction_id, custom_id })
        ]
      );
      const paymentIntentId = insert.insertId;

      // 4) OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
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
          subject: `Votre code de retrait - E·Doto Family`,
          message: `
<div style="font-family: 'Inter', Arial, sans-serif; max-width: 640px; margin: auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 40px rgba(0,0,0,0.06); border: 1px solid #f2f2f2;">
  
  <!-- Header -->
  <div style="background: linear-gradient(135deg, #fff5f8, #ffe4ef); padding: 32px 24px; text-align: center;">
    <img src="https://edotofamily.netlify.app/images/edotofamily6.1.png" alt="E·Doto Family" style="height: 72px; margin-bottom: 12px;" />
    <h1 style="color: #FF6EA9; font-size: 22px; font-weight: 700; margin: 0;">E·Doto Family</h1>
    <p style="color: #6B7280; font-size: 14px; margin-top: 6px;">Harmonie, bien-être et santé au féminin</p>
  </div>

  <!-- Body -->
  <div style="padding: 40px 30px; background-color: #ffffff; text-align: center;">
    <h2 style="color: #111827; font-size: 20px; margin-bottom: 12px;">Retrait de votre commande 🌸</h2>
    <p style="color: #4B5563; font-size: 15px; line-height: 1.7; margin: 0 auto; max-width: 460px;">
      Pour retirer votre commande <strong>${order.tracking_number}</strong>, utilisez le code ci-dessous :
    </p>

    <!-- OTP / Code -->
    <div style="font-size: 28px; font-weight: 700; color: #FF6EA9; margin: 30px 0; padding: 14px 24px; background: #FFF0F5; border-radius: 12px; display: inline-block; letter-spacing: 2px;">
      ${otp}
    </div>

    <p style="color: #6B7280; font-size: 14px; line-height: 1.6;">
      Ce code est valable pendant <strong>48 heures</strong> et ne peut être utilisé qu'une seule fois.<br/>
      Présentez-le au livreur ou au point de retrait lors de la récupération.
    </p>
  </div>

  <!-- Footer -->
  <div style="background: #fafafa; padding: 20px; text-align: center; border-top: 1px solid #f3f4f6;">
    <p style="color: #9CA3AF; font-size: 12px; margin: 0;">
      © ${new Date().getFullYear()} E·Doto Family — Tous droits réservés<br />
      <a href="https://edotofamily.netlify.app" style="color: #FF6EA9; text-decoration: none;">www.edotofamily.com</a>
    </p>
  </div>

</div>
      `,
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
  // Vérifie le paiement Flutterwave
  // ---------------------------
  private async verifyFlutterwavePayment(
    tx_ref: string,
    amount: number,
    currency: string,
  ): Promise<FlutterwavePaymentData> {
    try {
      const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY;
      if (!FLW_SECRET_KEY) throw new Error('Flutterwave secret key not configured');

      const response = await axios.get<{ status: string; message: string; data: FlutterwavePaymentData }>(
        `https://api.flutterwave.com/v3/transactions/verify_by_tx_ref?tx_ref=${tx_ref}`,
        { headers: { Authorization: `Bearer ${FLW_SECRET_KEY}` } }
      );

      const data = response.data?.data;

      if (!data || data.status !== 'successful') throw new Error('Payment not verified');
      if (data.amount !== amount || data.currency !== currency) throw new Error('Payment amount or currency mismatch');

      return data;
    } catch (error) {
      if (error instanceof AxiosError) {
        throw new Error(`Flutterwave API error: ${error.response?.data?.message || error.message}`);
      }
      throw error;
    }
  }

  // ---------------------------
  // Webhook Flutterwave
  // ---------------------------
  async handleFlutterwaveWebhook(body: any) {
    const tx_ref = body.data?.tx_ref;
    const transaction_id = body.data?.transaction_id;
    const status = body.data?.status;

    if (!tx_ref || !transaction_id || status !== 'successful') {
      return { success: false };
    }

    const [piRows] = await this.pool.query<RowDataPacket[]>(
      `SELECT * FROM payment_intents WHERE JSON_EXTRACT(payment_intent_info, '$.tx_ref') = ?`,
      [tx_ref]
    );
    const paymentIntent = piRows[0];
    if (!paymentIntent) return { success: false };

    await this.confirmPayment(paymentIntent.id, tx_ref, transaction_id);

    return { success: true };
  }

  // ---------------------------
  // Confirme le paiement et génère facture
  // ---------------------------
  async confirmPayment(paymentIntentId: number, tx_ref: string, transaction_id: string) {
    const [piRows] = await this.pool.query<RowDataPacket[]>(
      `SELECT * FROM payment_intents WHERE id = ?`,
      [paymentIntentId]
    );
    const paymentIntent = piRows[0];
    if (!paymentIntent) throw new Error("PaymentIntent not found");

    let paymentData: any = null;

    if (paymentIntent.payment_gateway === "flutterwave") {
      paymentData = await this.verifyFlutterwavePayment(
        tx_ref,
        paymentIntent.total_amount,
        paymentIntent.currency
      );
      if (!paymentData) throw new Error("Payment verification failed");
    }

    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query<ResultSetHeader>(
        `UPDATE payment_intents SET status = 'payment-success', updated_at = NOW() WHERE id = ?`,
        [paymentIntentId]
      );

      await conn.query<ResultSetHeader>(
        `UPDATE orders 
        SET order_status = 'order-processing', 
            payment_status = 'payment-success',
            updated_at = NOW() 
        WHERE id = ?`,
        [paymentIntent.order_id]
      );

      await conn.query<ResultSetHeader>(
        `UPDATE order_children 
        SET order_status = 'order-processing', 
            payment_status = 'payment-success',
            updated_at = NOW() 
        WHERE order_id = ?`,
        [paymentIntent.order_id]
      );

      // ✅ mise à jour wallets Visa Test 5438898014560229 09/32 789 John Doe
      await this.updateWallets(paymentIntent.order_id, conn);

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    await this.updateAnalytics(paymentIntent.total_amount, conn);

    // ✅ génère facture multi-shops + client
    await this.generateInvoices(paymentIntent.order_id, conn);

    return { success: true, paymentData };
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
        { resource_type: 'raw', public_id: publicId },
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
        this.logger.error(`Erreur génération facture commande ${order.tracking_number}`, err);
      }
    }
  }

  async retryPendingPayments() {
    this.logger.debug("Cron: retry des paiements pending/failed…");

    const [pending] = await this.pool.query<RowDataPacket[]>(
      `SELECT * 
     FROM pending_payments 
     WHERE status IN ('processing','failed')`
    );

    for (const p of pending) {
      const conn = await this.pool.getConnection();
      await conn.beginTransaction();

      try {
        this.logger.debug(
          `Retry pending payment ${p.id} (${p.transaction_id})`
        );

        // 1. Rejouer la logique interne
        const result = await this.completeFeexPayPayment(
          {
            transaction_id: p.transaction_id,
            custom_id: p.custom_id,
            feexpay_response: JSON.parse(p.raw_response || "{}")
          },
          conn // ✔ CORRECT
        );

        // 2. Marquer le retry comme OK
        await conn.query(
          `UPDATE pending_payments 
         SET status = 'processed', retried_at = NOW() 
         WHERE id = ?`,
          [p.id]
        );

        await conn.commit();
        this.logger.debug(
          `Pending payment ${p.id} traité avec succès.`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

        this.logger.error(`Retry échoué pour pending ${p.id}: ${msg}`);

        await conn.query(
          `UPDATE pending_payments 
         SET status = 'failed', last_error = ?, retry_count = retry_count + 1 
         WHERE id = ?`,
          [msg, p.id]
        );

        await conn.rollback();
      } finally {
        conn.release();
      }
    }
  }


}

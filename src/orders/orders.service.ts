import { Injectable, ForbiddenException, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { AuthService } from 'src/auth/auth.service';
import { FlutterwaveService } from 'src/payment/flutterwave.service';
import { FeexpayService } from 'src/payment/feexpay.service';
import { DatabaseService } from '../database/database.services';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { OrderPaginator } from './dto/order-paginator.dto';
import { GetOrdersDto } from './dto/get-orders.dto';
import { QueryOrdersOrderByColumn } from './dto/get-order.dto';
import { GetOrderStatusesDto } from './dto/get-order-statuses.dto';
import { CheckoutVerificationDto } from './dto/verify-checkout.dto';
import { GetOrderFilesDto, OrderFilesPaginator } from './dto/get-downloads.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

import {
  Order,
  Children,
  OrderStatusType,
  PaymentStatusType,
  PaymentGatewayType,
  PaymentIntentType,
} from './entities/order.entity';
import { PaymentInitDto } from 'src/payment-gateway/payment-gateway.interface';
import { hasRole, STAFF, STORE_OWNER, SUPER_ADMIN, SUPER_PICKUPPOINT } from '../auth/roles.decorator';
import {
  CUSTOMER_PAYMENT_GATEWAYS,
  orderRelation,
  pickUpdatableFields,
  presentOrderForRelation,
  safeSortDirection,
} from './order-access';
import { randomInt } from 'crypto';
import { sendVerificationEmail } from '../auth/mailer';
import { buildPickupOtpEmail, PICKUP_OTP_EMAIL_SUBJECT, PICKUP_OTP_TTL_MS } from './pickup-otp-email';
import { DeliveryService } from '../delivery/delivery.service';
import { parseCustomDelivery } from '../delivery/delivery-rules';
import { ORDER_COMMISSION_SET_SQL } from '../commissions/commission-rules';

// Le retrait est effectué quand le point de retrait a validé l'OTP (verifyOtp) :
// otp_used = 1, order_status = 'order-completed', delivered_at renseigné.
function isWithdrawn(order: { otp_used?: any; order_status?: string; delivered_at?: any }) {
  return Number(order.otp_used) === 1 || order.order_status === 'order-completed' || !!order.delivered_at;
}

function isOtpExpired(order: { otp_expires_at?: any }) {
  return !!order.otp_expires_at && new Date(order.otp_expires_at).getTime() < Date.now();
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly authService: AuthService,
    private readonly flutterwaveService: FlutterwaveService,
    private readonly feexpayService: FeexpayService,
    private readonly databaseService: DatabaseService,
    private readonly deliveryService?: DeliveryService,
  ) { }

  // Sans `delivery` : ancien parcours (le point de retrait est choisi après le paiement).
  private async resolveDeliveryChoice(choice: any) {
    if (choice === undefined || choice === null) return null;

    if (choice.type === 'PICKUP') {
      const pickupPointId = Number(choice.pickup_point_id);
      if (!Number.isInteger(pickupPointId) || pickupPointId <= 0) {
        throw new BadRequestException('Point de retrait invalide.');
      }
      const [rows]: any = await this.databaseService.getPool().query(
        `SELECT id, is_active, pickup_approved FROM users WHERE id = ? AND role = 'super_pickuppoint' LIMIT 1`,
        [pickupPointId],
      );
      const point = rows?.[0];
      if (!point || Number(point.pickup_approved) === 0) throw new BadRequestException('Point de retrait inconnu.');
      if (Number(point.is_active) === 0) throw new BadRequestException('Ce point de retrait est actuellement bloqué.');
      return { type: 'PICKUP' as const, pickupPointId };
    }

    if (choice.type === 'CUSTOM') {
      if (!this.deliveryService) throw new BadRequestException("La livraison à domicile n'est pas disponible.");
      const input = parseCustomDelivery(choice);
      const quote = await this.deliveryService.quote(input.lat, input.lng);
      return { type: 'CUSTOM' as const, input, quote };
    }

    throw new BadRequestException('Mode de retrait invalide.');
  }

  // =========================
  // CREATE ORDER
  // =========================
  async create(createOrderDto: CreateOrderDto, token: string, authUser?: any): Promise<Order> {
    const pool = this.databaseService.getPool();
    const user = await this.authService.me(token);

    // 🔒 Passerelle : un non-admin ne peut pas choisir CASH / FULL_WALLET_PAYMENT
    // (ces passerelles marquent la commande payée ou terminée sans aucune vérification)
    const requestedGateway = createOrderDto.payment_gateway || PaymentGatewayType.FEEXPAY;
    if (!hasRole(authUser, SUPER_ADMIN) && !CUSTOMER_PAYMENT_GATEWAYS.includes(requestedGateway)) {
      throw new BadRequestException('Moyen de paiement non autorisé.');
    }

    // 🔒 Prix calculés côté serveur depuis la table products (même règle que le front :
    // sale_price, sinon price). Les prix envoyés par le client sont ignorés.
    const items = Array.isArray(createOrderDto.products) ? createOrderDto.products : [];
    if (items.length === 0) throw new BadRequestException('Aucun produit dans la commande.');
    for (const item of items) {
      const qty = Number(item.order_quantity);
      if (!Number.isInteger(qty) || qty < 1) throw new BadRequestException('Quantité invalide.');
    }
    const productIds = [...new Set(items.map((i) => Number(i.product_id)))];
    const [priceRows]: any = await pool.query(
      `SELECT id, price, sale_price FROM products WHERE id IN (${productIds.map(() => '?').join(',')})`,
      productIds,
    );
    const priceById = new Map<number, number>();
    for (const row of priceRows) {
      const unit = row.sale_price !== null && row.sale_price !== undefined ? Number(row.sale_price) : Number(row.price);
      priceById.set(Number(row.id), unit);
    }
    for (const id of productIds) {
      if (!priceById.has(id) || !Number.isFinite(priceById.get(id))) {
        throw new BadRequestException(`Produit introuvable ou sans prix : ${id}`);
      }
    }

    // Lieu choisi AVANT le paiement (point de retrait ou livraison personnalisée) :
    // un seul paiement, produits + livraison. Les frais sont calculés ici, jamais repris du client.
    const delivery = await this.resolveDeliveryChoice(createOrderDto.delivery);

    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      const children: Children[] = items.map((item) => {
        const unit_price = priceById.get(Number(item.product_id));
        const order_quantity = Number(item.order_quantity);
        return {
          product_id: Number(item.product_id),
          order_quantity,
          unit_price,
          subtotal: unit_price * order_quantity,
          order_status: OrderStatusType.PENDING,
          payment_status: PaymentStatusType.PENDING,
        };
      });
      const productsTotal = children.reduce((sum, c) => sum + c.subtotal, 0);
      const deliveryFee = delivery?.type === 'CUSTOM' ? delivery.quote.fee : 0;
      const computedTotal = productsTotal + deliveryFee;

      const tempTrackingNumber = `TEMP-${Date.now()}`;

      const order: Order = {
        id: 0,
        tracking_number: tempTrackingNumber,
        customer_id: user.id,
        customer_contact: createOrderDto.customer_contact,
        customer: user,
        shop_id: createOrderDto.shop_id || null,
        coupon_id: createOrderDto.coupon_id || null,
        amount: productsTotal,
        sales_tax: 0,
        total: computedTotal,
        paid_total: computedTotal,
        payment_gateway: requestedGateway,
        order_status: OrderStatusType.PENDING,
        payment_status: PaymentStatusType.PENDING,
        children,
        delivery_fee: deliveryFee,
        delivery_time: createOrderDto.delivery_time,
        billing_address: createOrderDto.billing_address,
        shipping_address: createOrderDto.shipping_address,
        language: createOrderDto.language || 'fr',
        translated_languages: [],
        payment_intent: null,
        products: [],
        created_at: new Date(),
        updated_at: new Date(),
      };

      if (order.payment_gateway === PaymentGatewayType.CASH) {
        order.order_status = OrderStatusType.PROCESSING;
        order.payment_status = PaymentStatusType.CASH;
      } else if (order.payment_gateway === PaymentGatewayType.FULL_WALLET_PAYMENT) {
        order.order_status = OrderStatusType.COMPLETED;
        order.payment_status = PaymentStatusType.WALLET;
      }

      const [result]: any = await conn.query(
        `INSERT INTO orders
      (tracking_number, customer_id, shop_id, total, paid_total, payment_gateway, order_status, payment_status, coupon_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          order.tracking_number,
          order.customer_id,
          order.shop_id,
          order.total,
          order.paid_total,
          order.payment_gateway,
          order.order_status,
          order.payment_status,
          order.coupon_id,
        ],
      );

      order.id = result.insertId;
      order.tracking_number = `ORD-${order.id}-${Date.now()}`;
      await conn.query(`UPDATE orders SET tracking_number = ? WHERE id = ?`, [
        order.tracking_number,
        order.id,
      ]);

      if (delivery?.type === 'PICKUP') {
        await conn.query(
          `UPDATE orders SET amount = ?, pickup_point_id = ?, delivery_type = 'PICKUP' WHERE id = ?`,
          [productsTotal, delivery.pickupPointId, order.id],
        );
        order.pickup_point_id = delivery.pickupPointId;
      } else if (delivery?.type === 'CUSTOM') {
        await conn.query(
          `UPDATE orders SET amount = ?, delivery_type = 'CUSTOM', delivery_lat = ?, delivery_lng = ?, delivery_fee = ?
           WHERE id = ?`,
          [productsTotal, delivery.input.lat, delivery.input.lng, deliveryFee, order.id],
        );
        await this.deliveryService.insertForOrder(conn, order.id, delivery.input, delivery.quote);
        order.delivery_type = 'CUSTOM';
      }

      for (const child of order.children) {
        const [productRows]: any = await conn.query(
          `SELECT shop_id, image FROM products WHERE id = ?`,
          [child.product_id]
        );
        const product = productRows[0];

        await conn.query(
          `INSERT INTO order_children
         (order_id, product_id, order_quantity, unit_price, subtotal, order_status, payment_status, shop_id, image, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            order.id,
            child.product_id,
            child.order_quantity,
            child.unit_price,
            child.subtotal,
            child.order_status,
            child.payment_status,
            product?.shop_id || null,
            product?.image ? JSON.stringify(product.image) : null
          ]
        );
      }

      // ✅ Paiement Flutterwave
      if (order.payment_gateway === PaymentGatewayType.FLUTTERWAVE) {
        const paymentData: PaymentInitDto = {
          amount: order.total,
          currency: 'XOF',
          email: user.email || order.customer_contact,
          reference: order.tracking_number,
          metadata: {
            name: order.customer_contact,
            order_id: order.id,
          },
          callback_url: `${process.env.FRONTEND_URL}/payment/callback?ref=${order.tracking_number}`,
        };

        const paymentInitResponse = await this.flutterwaveService.initializePayment(paymentData);

        order.payment_intent = {
          id: Number(paymentInitResponse.payment_id ?? Date.now()),
          order_id: order.id,
          tracking_number: order.tracking_number,
          payment_gateway: paymentInitResponse.gateway,
          payment_intent_info: paymentInitResponse,
          order_status: OrderStatusType.PENDING,
          amount: order.total,
          currency: 'XOF',
        } as PaymentIntentType;

        await conn.query(
          `UPDATE orders SET payment_intent = ?, payment_status = ?, order_status = ? WHERE id = ?`,
          [
            JSON.stringify(order.payment_intent),
            PaymentStatusType.PENDING,
            OrderStatusType.PENDING,
            order.id,
          ],
        );
      }

      // ✅ Paiement Feexpay
      else if (order.payment_gateway === PaymentGatewayType.FEEXPAY) {
        // ✅ On NE fait plus d'appel HTTP à Feexpay ici
        // On prépare seulement la structure de "payment_intent"
        order.payment_intent = {
          id: Date.now(),
          order_id: order.id,
          tracking_number: order.tracking_number,
          payment_gateway: PaymentGatewayType.FEEXPAY,
          amount: order.total,
          currency: 'XOF',
          order_status: OrderStatusType.PENDING,
          payment_intent_info: null,
        } as PaymentIntentType;

        await conn.query(
          `UPDATE orders SET payment_intent = ?, payment_status = ?, order_status = ? WHERE id = ?`,
          [
            JSON.stringify(order.payment_intent),
            PaymentStatusType.PENDING,
            OrderStatusType.PENDING,
            order.id,
          ],
        );
      }


      await conn.commit();
      return order;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  // Vérifie l'OTP et marque la commande comme livrée si ok
  async verifyOtp(dto: VerifyOtpDto, user: { id: number; permissions: string[] }) {
    const pool = this.databaseService.getPool();

    if (!hasRole(user, SUPER_PICKUPPOINT)) {
      throw new ForbiddenException({ message: "Vous n'êtes pas autorisé à effectuer cette opération." });
    }

    const [rows]: any = await pool.query(
      `SELECT id, otp_code, otp_used, otp_expires_at, pickup_point_id, order_status
       FROM orders
       WHERE id = ? LIMIT 1`,
      [dto.order_id]
    );
    const order = rows?.[0];

    // Même message pour une commande inconnue ou rattachée à un autre point de retrait :
    // ne pas révéler l'existence d'une commande qui n'est pas la sienne
    if (!order || Number(order.pickup_point_id) !== Number(user.id)) {
      throw new NotFoundException({ message: 'Code OTP invalide ou commande introuvable.' });
    }

    if (order.otp_used) {
      throw new BadRequestException({ message: 'Ce code OTP a déjà été utilisé.' });
    }

    if (isOtpExpired(order)) {
      throw new BadRequestException({
        message: 'Ce code a expiré. Le client doit générer un nouveau code depuis sa commande.',
      });
    }

    if (!order.otp_code || String(order.otp_code) !== String(dto.otp_code).trim()) {
      await this.registerInvalidOtpAttempt(order.id);
      throw new NotFoundException({ message: 'Code OTP invalide ou commande introuvable.' });
    }

    // Tout est OK -> marquer comme livré (order-completed) + delivered_at + otp_used = 1
    // (otp_used = 0 dans le WHERE : pas de double validation concurrente)
    // Commission du point figée au moment du retrait (pourcentage du montant des produits)
    const [updateResult]: any = await pool.query(
      `UPDATE orders o
       SET o.order_status = ?, o.otp_used = 1, o.otp_attempts = o.otp_attempts + 1, o.delivered_at = NOW(),
           ${ORDER_COMMISSION_SET_SQL}
       WHERE o.id = ? AND o.otp_used = 0`,
      ['order-completed', order.id]
    );
    if (!updateResult?.affectedRows) {
      throw new BadRequestException({ message: 'Ce code OTP a déjà été utilisé.' });
    }

    const [updatedRows]: any = await pool.query(
      `SELECT * FROM orders WHERE id = ? LIMIT 1`,
      [order.id]
    );

    return { success: true, order: presentOrderForRelation(updatedRows[0], 'pickup') };
  }

  // Nouveau code de retrait : uniquement pour le client de la commande, si la commande est
  // payée, que le code précédent a expiré et que le retrait n'a pas été effectué.
  async regenerateOtp(orderId: number, user: any) {
    const pool = this.databaseService.getPool();
    const [rows]: any = await pool.query(
      `SELECT o.id, o.customer_id, o.tracking_number, o.payment_status, o.order_status,
              o.otp_code, o.otp_used, o.otp_expires_at, o.delivered_at, u.email
       FROM orders o
       JOIN users u ON u.id = o.customer_id
       WHERE o.id = ? LIMIT 1`,
      [orderId],
    );
    const order = rows[0];
    if (!order) throw new NotFoundException('Commande introuvable.');
    if (Number(order.customer_id) !== Number(user?.id)) {
      throw new ForbiddenException("Vous n'avez pas accès à cette commande.");
    }
    if (order.payment_status !== 'payment-success') {
      throw new BadRequestException("Cette commande n'est pas payée : aucun code de retrait.");
    }
    if (isWithdrawn(order)) {
      throw new BadRequestException('Cette commande a déjà été retirée.');
    }
    if (['order-cancelled', 'order-refunded', 'order-failed'].includes(order.order_status)) {
      throw new BadRequestException('Cette commande ne peut plus être retirée.');
    }
    if (!order.otp_code || !order.otp_expires_at) {
      throw new BadRequestException("Aucun code de retrait n'a été émis pour cette commande.");
    }
    if (!isOtpExpired(order)) {
      throw new BadRequestException(
        `Votre code est encore valable jusqu'au ${new Date(order.otp_expires_at).toLocaleString('fr-FR')}.`,
      );
    }

    const otp = randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + PICKUP_OTP_TTL_MS);

    // Conditions revérifiées dans le WHERE : si le point de retrait valide entre-temps,
    // ou si un autre appel a déjà régénéré le code, rien n'est modifié.
    const [result]: any = await pool.query(
      `UPDATE orders
       SET otp_code = ?, otp_expires_at = ?, otp_attempts = 0, updated_at = NOW()
       WHERE id = ? AND otp_code = ? AND otp_used = 0 AND delivered_at IS NULL
         AND order_status <> 'order-completed'`,
      [otp, expiresAt, order.id, order.otp_code],
    );
    if (!result?.affectedRows) {
      throw new BadRequestException("La commande a changé entre-temps. Rechargez la page.");
    }

    try {
      await sendVerificationEmail({
        email: order.email,
        subject: PICKUP_OTP_EMAIL_SUBJECT,
        message: buildPickupOtpEmail(order.tracking_number, otp),
      });
    } catch (e) {
      // Sans e-mail, le client ne connaîtrait pas le nouveau code : on remet l'ancien (expiré)
      // pour qu'il puisse relancer la génération.
      await pool.query(
        `UPDATE orders SET otp_code = ?, otp_expires_at = ? WHERE id = ? AND otp_code = ? AND otp_used = 0`,
        [order.otp_code, order.otp_expires_at, order.id, otp],
      );
      throw new InternalServerErrorException("Impossible d'envoyer l'e-mail. Réessayez dans quelques instants.");
    }

    return {
      success: true,
      otp_expires_at: expiresAt,
      message: 'Un nouveau code de retrait vous a été envoyé par e-mail.',
    };
  }

  // Optionnel : incrementer tentative OTP si tentative incorrecte
  async registerInvalidOtpAttempt(orderId: number) {
    const pool = this.databaseService.getPool();
    await pool.query(
      `UPDATE orders SET otp_attempts = otp_attempts + 1 WHERE id = ?`,
      [orderId]
    );
  }


  // =========================
  // PAYMENTS
  // =========================
  async flutterwavePay(order: Order) {
    await this.flutterwaveService.pay(order);
    this.updateOrderStatusAfterPayment(
      order,
      OrderStatusType.COMPLETED,
      PaymentStatusType.SUCCESS,
    );
  }

  updateOrderStatusAfterPayment(
    order: Order,
    orderStatus: OrderStatusType,
    paymentStatus: PaymentStatusType,
  ) {
    order.order_status = orderStatus;
    order.payment_status = paymentStatus;
    order.children = order.children.map((child: Children) => ({
      ...child,
      order_status: orderStatus,
      payment_status: paymentStatus,
    }));
  }

  processChildrenOrder(order: Order): Children[] {
    return (order.children || []).map((child: Children) => ({
      ...child,
      order_status: order.order_status,
      payment_status: order.payment_status,
    }));
  }

  // =========================


  // 📌 STATS PICKUP POINT
  async getPickupStats(pickupPointId: number) {
    const pool = this.databaseService.getPool();

    const [rows]: any = await pool.query(
      `
    SELECT 
      COUNT(*) AS total,
      SUM(order_status = 'order-completed') AS completed,
      SUM(order_status != 'order-completed') AS pending
    FROM orders
    WHERE pickup_point_id = ? AND is_archived = 0 AND payment_status = 'payment-success'
    `,
      [pickupPointId]
    );

    return {
      total: rows[0].total ?? 0,
      completed: rows[0].completed ?? 0,
      pending: rows[0].pending ?? 0,
    };
  }


  async getStats(user) {
    const pool = this.databaseService.getPool();

    let where = `WHERE is_archived = 0`;
    const params = [];

      // Le point de retrait est choisi avant le paiement : un point ne voit que les commandes payées
    if (user.permissions?.includes('super_pickuppoint')) {
      where += ` AND pickup_point_id = ? AND payment_status = 'payment-success'`;
      params.push(user.id);
    }

    const [statsRows]: any = await pool.query(
      `
    SELECT
      COUNT(*) AS total_orders,
      SUM(order_status = 'order-completed') AS validated_orders,
      SUM(order_status != 'order-completed') AS pending_orders,
      SUM(DATE(created_at) = CURDATE()) AS today_new_orders
    FROM orders
    ${where}
    `,
      params
    );

    const stats = statsRows[0];
    return stats;
  }

  async archiveOrder(orderId: number, user) {
    const pool = this.databaseService.getPool();

    // Sécurité PickupPoint 
    //Sécurité PickupPoint
    // Sécurité : l'admin passe, sinon seul le point de retrait de la commande
    if (!hasRole(user, SUPER_ADMIN)) {
      const [orderRows]: any = await pool.query(
        `SELECT pickup_point_id FROM orders WHERE id = ?`,
        [orderId]
      );

      const order = orderRows[0];

      if (!order || Number(order.pickup_point_id) !== Number(user.id)) {
        throw new ForbiddenException("Vous ne pouvez pas archiver cette commande");
      }
    }

    await pool.query(
      `UPDATE orders SET is_archived = 1 WHERE id = ?`,
      [orderId]
    );

    return { message: "Commande archivée" };
  }

  async unarchiveOrder(orderId: number, user?: any) {
    const pool = this.databaseService.getPool();

    if (!hasRole(user, SUPER_ADMIN)) {
      const [orderRows]: any = await pool.query(
        `SELECT pickup_point_id FROM orders WHERE id = ?`,
        [orderId]
      );
      const order = orderRows[0];
      if (!order || Number(order.pickup_point_id) !== Number(user?.id)) {
        throw new ForbiddenException("Vous ne pouvez pas restaurer cette commande");
      }
    }

    await pool.query(
      `UPDATE orders SET is_archived = 0 WHERE id = ?`,
      [orderId]
    );

    return { message: "Commande restaurée" };
  }

  async getNewOrders(user) {
    const pool = this.databaseService.getPool();

    const where = [`is_archived = 0`, `order_status != 'order-completed'`];
    const params = [];

    if (!hasRole(user, SUPER_ADMIN)) {
      // Le point de retrait est choisi avant le paiement : un point ne voit que les commandes payées
      where.push(`pickup_point_id = ?`, `payment_status = 'payment-success'`);
      params.push(user.id);
    }

    const [rows]: any = await pool.query(
      `SELECT * FROM orders 
     WHERE ${where.join(" AND ")} 
     ORDER BY created_at DESC 
     LIMIT 20`,
      params
    );

    return hasRole(user, SUPER_ADMIN) ? rows : rows.map((r) => presentOrderForRelation(r, 'pickup'));
  }


  // 📌 GET ORDERS (pickup + user normal)
  // Compatible MySQL + pool.query
  async getOrders(query: GetOrdersDto, user) {
    const pool = this.databaseService.getPool();
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 15));
    const page = Math.max(1, Number(query.page) || 1);
    const { orderBy = 'created_at', sortedBy = 'DESC' } = query;
    const offset = (page - 1) * limit;

    const scope = await this.orderScope(query, user);
    if (scope.empty) {
      return { data: [], total: 0, page, last_page: 0, next_page_url: false, prev_page_url: false };
    }
    const { where, params, isAdmin, isPickup, isShop } = scope;
    this.applyOrderFilters(query, where, params, isAdmin);

    let sql = `SELECT * FROM orders WHERE ` + where.join(' AND ');

    // whitelist ORDER BY
    const allowedOrder = {
      created_at: 'created_at',
      total: 'total',
      updated_at: 'updated_at'
    };
    const safeOrderBy = allowedOrder[orderBy] || 'created_at';

    sql += ` ORDER BY ${safeOrderBy} ${safeSortDirection(sortedBy)}, id DESC LIMIT ? OFFSET ?`;

    const [[rows], [count]]: any = await Promise.all([
      pool.query(sql, [...params, limit, offset]),
      pool.query(`SELECT COUNT(*) as total FROM orders WHERE ${where.join(' AND ')}`, params),
    ]);
    const total = Number(count[0].total);

    const relation = isAdmin ? 'admin' : isPickup ? 'pickup' : isShop ? 'shop' : 'customer';

    // Admin (G2) : nom du point de retrait et du client pour la liste des commandes
    // (2 requêtes groupées pour toute la page ; la requête principale est inchangée)
    if (isAdmin && rows.length) {
      const idsOf = (key: string): number[] => [...new Set<number>(rows.map((r: any) => Number(r[key])).filter((n: number) => n > 0))];
      const pickupIds = idsOf('pickup_point_id');
      const customerIds = idsOf('customer_id');
      const byId = async (ids: number[]) => {
        if (!ids.length) return new Map<number, any>();
        const [u]: any = await pool.query(`SELECT id, name, email FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
        return new Map<number, any>(u.map((x: any) => [Number(x.id), x]));
      };
      const [points, customers] = await Promise.all([byId(pickupIds), byId(customerIds)]);
      for (const r of rows) {
        r.pickup_point_name = points.get(Number(r.pickup_point_id))?.name ?? null;
        const c = customers.get(Number(r.customer_id));
        r.customer_display = c ? { name: c.name, email: c.email } : null;
      }
    }

    return {
      data: rows.map((r) => presentOrderForRelation(r, relation)),
      total,
      page,
      last_page: Math.ceil(total / limit),
      next_page_url: page < Math.ceil(total / limit),
      prev_page_url: page > 1,
    };
  }

  // Filtres réels (colonnes de la table orders), appliqués à l'intérieur du périmètre du rôle :
  // statut, paiement, mode de retrait, commande de campagne ou boutique, point de retrait (admin),
  // période (jours au Bénin, UTC+1) et montant total.
  applyOrderFilters(query: any, where: string[], params: any[], isAdmin: boolean) {
    const list = (v: any) => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const ORDER_STATUSES = ['order-pending', 'order-processing', 'order-completed', 'order-cancelled', 'order-refunded', 'order-failed', 'order-at-local-facility', 'order-out-for-delivery'];
    const PAYMENT_STATUSES = ['payment-pending', 'payment-processing', 'payment-success', 'payment-failed', 'payment-cash-on-delivery', 'payment-cash', 'payment-wallet', 'payment-awaiting-for-approval'];
    const statuses = list(query.order_status).filter((s) => ORDER_STATUSES.includes(s));
    if (statuses.length) { where.push(`order_status IN (${statuses.map(() => '?').join(',')})`); params.push(...statuses); }
    const payments = list(query.payment_status).filter((s) => PAYMENT_STATUSES.includes(s));
    if (payments.length) { where.push(`payment_status IN (${payments.map(() => '?').join(',')})`); params.push(...payments); }
    if (query.delivery_type === 'PICKUP' || query.delivery_type === 'CUSTOM') { where.push('delivery_type = ?'); params.push(query.delivery_type); }
    if (query.kind === 'campaign') where.push('campaign_id IS NOT NULL');
    if (query.kind === 'shop') where.push('campaign_id IS NULL');
    const campaignId = Number(query.campaign_id);
    if (query.campaign_id && Number.isInteger(campaignId) && campaignId > 0) { where.push('campaign_id = ?'); params.push(campaignId); }
    // Point de retrait précis : déjà appliqué par le périmètre (imposé pour un point, libre pour l'admin)
    if (isAdmin && query.pickup_point_id === 'none') where.push('pickup_point_id IS NULL');
    const day = (s: any) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
    const beninDayUtc = (s: string, addDays = 0) => {
      const [y, m, d] = s.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d + addDays) - 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    };
    const from = day(query.date_from);
    const to = day(query.date_to);
    if (from) { where.push('created_at >= ?'); params.push(beninDayUtc(from)); }
    if (to) { where.push('created_at < ?'); params.push(beninDayUtc(to, 1)); }
    const min = Number(query.min_total);
    if (query.min_total !== undefined && String(query.min_total) !== '' && Number.isFinite(min)) { where.push('total >= ?'); params.push(min); }
    const max = Number(query.max_total);
    if (query.max_total !== undefined && String(query.max_total) !== '' && Number.isFinite(max)) { where.push('total <= ?'); params.push(max); }
  }

  // Compteurs réels pour les filtres (dans le périmètre du rôle, hors filtres déjà choisis)
  async getOrderFacets(query: any, user) {
    const pool = this.databaseService.getPool();
    const scope = await this.orderScope(query, user);
    if (scope.empty) return { total: 0, order_status: [], payment_status: [], delivery_type: [], kind: { campaign: 0, shop: 0 }, pickup_points: [], total_range: { min: null, max: null } };
    const { where, params, isAdmin } = scope;
    const w = where.join(' AND ');
    const [[st], [pay], [del], [kind], [range], points]: any = await Promise.all([
      pool.query(`SELECT order_status AS v, COUNT(*) AS n FROM orders WHERE ${w} GROUP BY order_status ORDER BY n DESC`, params),
      pool.query(`SELECT payment_status AS v, COUNT(*) AS n FROM orders WHERE ${w} GROUP BY payment_status ORDER BY n DESC`, params),
      pool.query(`SELECT delivery_type AS v, COUNT(*) AS n FROM orders WHERE ${w} GROUP BY delivery_type ORDER BY n DESC`, params),
      pool.query(`SELECT SUM(campaign_id IS NOT NULL) AS campaign, SUM(campaign_id IS NULL) AS shop, COUNT(*) AS total FROM orders WHERE ${w}`, params),
      pool.query(`SELECT MIN(total) AS min, MAX(total) AS max FROM orders WHERE ${w}`, params),
      isAdmin
        ? pool.query(
            `SELECT o.pickup_point_id AS id, u.name, COUNT(*) AS n FROM orders o LEFT JOIN users u ON u.id = o.pickup_point_id
             WHERE ${where.map((c) => c.replace(/\b(is_archived|pickup_point_id|customer_id|payment_status)\b/g, 'o.$1')).join(' AND ')}
             GROUP BY o.pickup_point_id, u.name ORDER BY n DESC`,
            params,
          )
        : Promise.resolve([[]]),
    ]);
    const num = (v: any) => Number(v ?? 0);
    return {
      total: num(kind[0]?.total),
      order_status: st.map((r: any) => ({ value: r.v, count: num(r.n) })),
      payment_status: pay.map((r: any) => ({ value: r.v, count: num(r.n) })),
      delivery_type: del.filter((r: any) => r.v).map((r: any) => ({ value: r.v, count: num(r.n) })),
      kind: { campaign: num(kind[0]?.campaign), shop: num(kind[0]?.shop) },
      pickup_points: (points[0] ?? []).map((r: any) => ({ id: r.id == null ? null : Number(r.id), name: r.name ?? null, count: num(r.n) })),
      total_range: { min: range[0]?.min != null ? Number(range[0].min) : null, max: range[0]?.max != null ? Number(range[0].max) : null },
    };
  }

  // Périmètre imposé par le rôle (jamais par les paramètres du client) + recherche
  private async orderScope(query: GetOrdersDto, user) {
    const { search, customer_id, pickup_point_id } = query;

    // ----------------------------
    // 🔐 Périmètre imposé par le rôle (jamais par les paramètres du client)
    // ----------------------------
    const isAdmin = hasRole(user, SUPER_ADMIN);
    const isPickup = !isAdmin && hasRole(user, SUPER_PICKUPPOINT);
    const isShop = !isAdmin && !isPickup && hasRole(user, STORE_OWNER, STAFF);
    let scopedCustomerId = customer_id;
    // « none » (admin) = commandes sans point de retrait, traité dans applyOrderFilters
    let scopedPickupId = String(pickup_point_id) === 'none' ? undefined : pickup_point_id;
    let shopIds: number[] = [];

    if (isPickup) {
      if (pickup_point_id && +pickup_point_id !== Number(user.id)) {
        throw new ForbiddenException("Vous ne pouvez accéder qu'à vos commandes");
      }
      scopedPickupId = Number(user.id);
    } else if (isShop) {
      shopIds = await this.getUserShopIds(user);
    } else if (!isAdmin) {
      if (customer_id && +customer_id !== Number(user.id)) {
        throw new ForbiddenException("Vous ne pouvez accéder qu'à vos commandes");
      }
      scopedCustomerId = Number(user.id);
    }

    const params: any[] = [];

    const where: string[] = [`is_archived = 0`];  // 👈 support archive

    // Client filter
    if (scopedCustomerId) {
      where.push(`customer_id = ?`);
      params.push(scopedCustomerId);
    }

    // PickupPoint filter
    if (scopedPickupId) {
      where.push(`pickup_point_id = ?`);
      params.push(scopedPickupId);
    }
    // Le point de retrait est choisi avant le paiement : un point ne voit que les commandes payées
    if (isPickup) {
      where.push(`payment_status = 'payment-success'`);
    }

    // Boutique : commandes contenant au moins un produit d'une boutique gérée
    if (isShop) {
      if (shopIds.length === 0) {
        return { where, params, isAdmin, isPickup, isShop, empty: true };
      }
      where.push(`id IN (SELECT order_id FROM order_children WHERE shop_id IN (${shopIds.map(() => '?').join(',')}))`);
      params.push(...shopIds);
    }

    // Search filter
    // L'OTP n'est cherchable qu'à l'identique hors admin : un LIKE permettrait de le deviner caractère par caractère
    if (search) {
      where.push(`(
      tracking_number LIKE ?
      OR ${isAdmin ? 'otp_code LIKE ?' : 'otp_code = ?'}
      OR customer_name LIKE ?
      OR customer_contact LIKE ?
    )`);
      params.push(
        `%${search}%`,
        isAdmin ? `%${search}%` : String(search),
        `%${search}%`,
        `%${search}%`
      );
    }

    return { where, params, isAdmin, isPickup, isShop, empty: false };
  }

  // Boutiques gérées par l'utilisateur : shops.owner_id (store_owner) ou users.shop_id (staff)
  async getUserShopIds(user: any): Promise<number[]> {
    const pool = this.databaseService.getPool();
    const ids = new Set<number>();
    if (hasRole(user, STORE_OWNER)) {
      const [rows]: any = await pool.query(`SELECT id FROM shops WHERE owner_id = ?`, [user.id]);
      rows.forEach((r) => ids.add(Number(r.id)));
    }
    if (hasRole(user, STAFF)) {
      const [rows]: any = await pool.query(`SELECT shop_id FROM users WHERE id = ? AND shop_id IS NOT NULL`, [user.id]);
      rows.forEach((r) => ids.add(Number(r.shop_id)));
    }
    return [...ids];
  }

  private async relationFor(user: any, order: any) {
    let userShopIds: number[] = [];
    let orderShopIds: number[] = [];
    if (!hasRole(user, SUPER_ADMIN) && hasRole(user, STORE_OWNER, STAFF)) {
      const pool = this.databaseService.getPool();
      userShopIds = await this.getUserShopIds(user);
      const [rows]: any = await pool.query(
        `SELECT DISTINCT shop_id FROM order_children WHERE order_id = ? AND shop_id IS NOT NULL`,
        [order.id],
      );
      orderShopIds = rows.map((r) => Number(r.shop_id));
    }
    return orderRelation(user, order, userShopIds, orderShopIds);
  }

  // Lecture d'une commande avec contrôle d'accès (IDOR) et masquage de l'OTP selon le rôle
  async getOrderForUser(idOrTracking: string | number, user: any) {
    const order = await this.getOrderByIdOrTrackingNumber(idOrTracking);
    if (!order) throw new NotFoundException('Commande introuvable.');
    const relation = await this.relationFor(user, order);
    if (!relation) throw new ForbiddenException("Vous n'avez pas accès à cette commande.");
    const presented: any = presentOrderForRelation(order as any, relation);
    if ((order as any).delivery_type === 'CUSTOM' && this.deliveryService && (relation === 'admin' || relation === 'customer')) {
      presented.custom_delivery = await this.deliveryService.infoForOrder(order.id, relation);
    }
    return presented;
  }

  // PUT /orders/:id : seuls les champs autorisés pour la relation sont écrits
  async updateForUser(id: number, body: Record<string, any>, user: any) {
    const pool = this.databaseService.getPool();
    const [rows]: any = await pool.query(
      `SELECT id, customer_id, pickup_point_id, order_status, payment_status, otp_used, delivery_type FROM orders WHERE id = ? LIMIT 1`,
      [id],
    );
    const order = rows[0];
    if (!order) throw new NotFoundException('Commande introuvable.');

    const relation = await this.relationFor(user, order);
    if (!relation) throw new ForbiddenException("Vous n'avez pas accès à cette commande.");

    const fields = pickUpdatableFields(relation, body);
    if (Object.keys(fields).length === 0) {
      throw new BadRequestException('Aucun champ modifiable fourni.');
    }

    if (relation === 'customer') {
      // Livraison à domicile payée avec la commande : le lieu ne change plus ensuite
      if (order.delivery_type === 'CUSTOM') {
        throw new BadRequestException('Livraison à domicile : le lieu de livraison ne peut plus être modifié.');
      }
      // L'ancien « point personnalisé » décrit après paiement n'existe plus (la livraison se paie avant)
      if (fields.pickup_point_id === null) {
        throw new BadRequestException('Choisissez un point de retrait.');
      }
    }

    // Sur la page de la commande, le client ne choisit un point de retrait qu'une fois la commande payée
    // (06/10/2026 : le point se choisit à la commande ; une commande en attente de paiement ne le propose pas)
    if (relation === 'customer' && fields.pickup_point_id !== undefined && order.payment_status !== 'payment-success') {
      throw new BadRequestException('Commande non payée : le point de retrait ne peut pas être choisi ici.');
    }

    // Le client ne change plus de point de retrait une fois la commande retirée
    if (relation === 'customer' && (order.otp_used || order.order_status === 'order-completed')) {
      throw new BadRequestException('Commande déjà retirée : modification impossible.');
    }

    if (fields.pickup_point_id) {
      const [pickupRows]: any = await pool.query(
        `SELECT id, is_active, pickup_approved FROM users WHERE id = ? AND role = 'super_pickuppoint' LIMIT 1`,
        [fields.pickup_point_id],
      );
      const point = pickupRows[0];
      if (!point || Number(point.pickup_approved) === 0) throw new BadRequestException('Point de retrait inconnu.');
      // Un point bloqué reste affiché mais ne peut plus être choisi
      // (sauf s'il s'agit déjà du point de la commande : pas de régression sur la note seule)
      if (Number(point.is_active) === 0 && Number(order.pickup_point_id) !== Number(point.id)) {
        throw new BadRequestException('Ce point de retrait est actuellement bloqué.');
      }
    }

    const updated = await this.update(id, fields as UpdateOrderDto);
    return presentOrderForRelation(updated, relation);
  }

  // orders.service.ts
  async updateDeliveryLocation(orderId: number, lat: number, lng: number) {
    const pool = this.databaseService.getPool();
    await pool.query(
      `UPDATE orders SET delivery_type='CUSTOM', delivery_lat=?, delivery_lng=? WHERE id=?`,
      [lat, lng, orderId]
    );
  }
  async getOrderByIdOrTrackingNumber(idOrTracking: string | number): Promise<Order | null> {
    console.log('DEBUG >>> Fonction appelée avec idOrTracking =', idOrTracking);
    const pool = this.databaseService.getPool();

    // Sécuriser l'entrée
    if (!idOrTracking || idOrTracking === 'NaN') {
      console.log('DEBUG >>> idOrTracking invalide');
      return null;
    }

    const [rows]: any = await pool.query(
      `SELECT * FROM orders WHERE id = ? OR tracking_number = ? LIMIT 1`,
      [idOrTracking, idOrTracking],
    );

    const order = rows[0];
    if (!order) return null;
    // 🔥 Charger les infos du pickup point si défini
    if (order.pickup_point_id) {
      try {
        const [pickupRows]: any = await pool.query(
          `SELECT id, name, pickup_lng, pickup_lat, email FROM users WHERE id = ? LIMIT 1`,
          [order.pickup_point_id]
        );

        order.pickup_point = pickupRows[0] || null;

      } catch (e) {
        console.error("Erreur lors du chargement du pickup point:", e);
        order.pickup_point = null;
      }
    } else {
      // Pour le front : toujours renvoyer une clé pickup_point
      order.pickup_point = null;
    }
    if (order.customer_id) {
      try {
        const [pickupRowsCustomer]: any = await pool.query(
          `SELECT id, name, email FROM users WHERE id = ? LIMIT 1`,
          [order.customer_id]
        );

        order.pickupRowsCustomer = pickupRowsCustomer[0] || null;

      } catch (e) {
        console.error("Erreur lors du chargement du pickup point:", e);
        order.customer_id = null;
      }
    } else {
      // Pour le front : toujours renvoyer une clé pickup_point
      order.customer_id = null;
    }
    // Récupérer les enfants de la commande
    const [childrenRows]: any = await pool.query(
      `SELECT 
      oc.*, 
      p.name, 
      p.price,
      p.shop_id,
      p.image
   FROM order_children oc
   JOIN products p ON oc.product_id = p.id
   WHERE oc.order_id = ?`,
      [order.id],
    );

    // Normalisation des enfants pour le front
    const normalizedChildren = childrenRows.map((child) => ({
      id: child.product_id,
      name: child.name,
      price: child.price,
      quantity: child.order_quantity,     // utilisé par le front MAJ
      order_quantity: child.order_quantity, // rétrocompatibilité.
      subtotal: child.subtotal,
      order_status: child.order_status,
      payment_status: child.payment_status,
      created_at: child.created_at,
      shop_id: child.shop_id,              // nouveau champ
      image: typeof child.image === 'string' ? JSON.parse(child.image) : child.image || null
    }));

    // Assigner à order.products (pour le front) et order.children (usage interne)
    order.products = normalizedChildren;
    order.children = normalizedChildren;


    // Mapper payment_intent si existant
    if (order.payment_intent) {
      try {
        order.payment_intent = JSON.parse(order.payment_intent);
      } catch (e) {
        order.payment_intent = null;
      }
    }

    // Si wallet_point existe dans la DB, parser JSON sinon valeur par défaut
    if (order.wallet_point) {
      try {
        order.wallet_point = JSON.parse(order.wallet_point);
      } catch (e) {
        order.wallet_point = { amount: 0, currency: 'XOF' };
      }
    } else {
      order.wallet_point = { amount: 0, currency: 'XOF' };
    }

    // S'assurer que certains champs sont toujours définis
    order.tracking_number = order.tracking_number || `ORD-${order.id}-${Date.now()}`;
    order.amount = Number(order.amount) || 0;
    order.sales_tax = Number(order.sales_tax) || 0;
    order.total = Number(order.total) || order.amount + order.sales_tax;
    order.paid_total = Number(order.paid_total) || order.total;
    order.delivery_fee = Number(order.delivery_fee) || 0;

    return order;
  }




  // =========================
  // VERIFY CHECKOUT
  // =========================
  verifyCheckout(input: CheckoutVerificationDto) {
    return {
      total_tax: 0,
      shipping_charge: 0,
      unavailable_products: [],
      wallet_currency: 5000,
      wallet_amount: 1500,
    };
  }

  // =========================
  // ORDER STATUS
  // =========================
  async getOrderStatuses(query: GetOrderStatusesDto) {
    const pool = this.databaseService.getPool();
    const { limit = 30, page = 1 } = query;
    const offset = (page - 1) * limit;

    const [rows]: any = await pool.query(
      `SELECT * FROM order_status LIMIT ? OFFSET ?`,
      [limit, offset],
    );
    const [countRows]: any = await pool.query(
      `SELECT COUNT(*) as total FROM order_status`,
    );
    const total = countRows[0].total;

    return { data: rows, total, limit, offset };
  }

  // =========================
  // ORDER FILES
  // =========================
  async getOrderFileItems(
    query: GetOrderFilesDto,
  ): Promise<OrderFilesPaginator> {
    const pool = this.databaseService.getPool();
    const { per_page = 30, current_page = 1 } = query;
    const offset = (current_page - 1) * per_page;

    const [rows]: any = await pool.query(
      `SELECT * FROM order_files LIMIT ? OFFSET ?`,
      [per_page, offset],
    );
    const [countRows]: any = await pool.query(
      `SELECT COUNT(*) as total FROM order_files`,
    );
    const total = countRows[0].total;
    const last_page = Math.ceil(total / per_page);

    const paginator: OrderFilesPaginator = {
      data: rows,
      count: rows.length,
      current_page,
      firstItem: offset + 1,
      lastItem: offset + rows.length,
      last_page,
      per_page,
      total,
      first_page_url: `/downloads?page=1`,
      last_page_url: `/downloads?page=${last_page}`,
      next_page_url:
        current_page < last_page ? `/downloads?page=${current_page + 1}` : null,
      prev_page_url:
        current_page > 1 ? `/downloads?page=${current_page - 1}` : null,
    };

    return paginator;
  }

  async getDigitalFileDownloadUrl(digitalFileId: number) {
    const pool = this.databaseService.getPool();
    const [rows]: any = await pool.query(
      `SELECT * FROM order_files WHERE digital_file_id = ?`,
      [digitalFileId],
    );
    return rows[0]?.file_url || null;
  }

  async exportOrder(shop_id: string) {
    return `/exports/order_${shop_id}.csv`;
  }

  async downloadInvoiceUrl(shop_id: string) {
    return `/invoices/invoice_${shop_id}.pdf`;
  }

  // =========================
  // UPDATE / REMOVE
  // =========================
  async update(id: number, updateOrderInput: UpdateOrderDto) {
    const pool = this.databaseService.getPool();
    const keys = Object.keys(updateOrderInput);
    const values = Object.values(updateOrderInput);
    if (keys.length === 0 || keys.some((k) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k))) {
      throw new BadRequestException('Champs invalides.');
    }
    const setSql = keys.map((k) => `${k} = ?`).join(',');
    await pool.query(`UPDATE orders SET ${setSql}, updated_at = NOW() WHERE id = ?`, [
      ...values,
      id,
    ]);
    const [rows]: any = await pool.query(`SELECT * FROM orders WHERE id = ?`, [
      id,
    ]);
    return rows[0];
  }

  async remove(id: number) {
    const pool = this.databaseService.getPool();
    await pool.query(`DELETE FROM order_children WHERE order_id = ?`, [id]);
    await pool.query(`DELETE FROM orders WHERE id = ?`, [id]);
    return `Order #${id} removed`;
  }

  // =========================
  // ORDER STATUS CRUD
  // =========================
  async createOrderStatus(createOrderStatusDto: any) {
    const pool = this.databaseService.getPool();
    const [result]: any = await pool.query(
      `INSERT INTO order_status (name, description, created_at, updated_at) VALUES (?, ?, NOW(), NOW())`,
      [createOrderStatusDto.name, createOrderStatusDto.description],
    );
    const [rows]: any = await pool.query(
      `SELECT * FROM order_status WHERE id = ?`,
      [result.insertId],
    );
    return rows[0];
  }

  async getOrderStatus(param: string, language?: string) {
    const pool = this.databaseService.getPool();
    const [rows]: any = await pool.query(
      `SELECT * FROM order_status WHERE id = ? OR name = ? LIMIT 1`,
      [param, param],
    );
    return rows[0] || null;
  }
}

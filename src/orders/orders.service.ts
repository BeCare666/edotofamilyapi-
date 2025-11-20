import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
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

@Injectable()
export class OrdersService {
  constructor(
    private readonly authService: AuthService,
    private readonly flutterwaveService: FlutterwaveService,
    private readonly feexpayService: FeexpayService,
    private readonly databaseService: DatabaseService,
  ) { }

  // =========================
  // CREATE ORDER
  // =========================
  async create(createOrderDto: CreateOrderDto, token: string): Promise<Order> {
    const pool = this.databaseService.getPool();
    const user = await this.authService.me(token);
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      const children: Children[] = createOrderDto.products.map((item) => ({
        product_id: item.product_id,
        order_quantity: item.order_quantity,
        unit_price: item.unit_price,
        subtotal: item.subtotal,
        order_status: OrderStatusType.PENDING,
        payment_status: PaymentStatusType.PENDING,
      }));

      const tempTrackingNumber = `TEMP-${Date.now()}`;

      const order: Order = {
        id: 0,
        tracking_number: tempTrackingNumber,
        customer_id: user.id,
        customer_contact: createOrderDto.customer_contact,
        customer: user,
        shop_id: createOrderDto.shop_id || null,
        coupon_id: createOrderDto.coupon_id || null,
        amount: createOrderDto.amount,
        sales_tax: createOrderDto.sales_tax,
        total:
          createOrderDto.total ||
          createOrderDto.amount + createOrderDto.sales_tax,
        paid_total:
          createOrderDto.paid_total ||
          (createOrderDto.total || createOrderDto.amount + createOrderDto.sales_tax),
        payment_gateway:
          createOrderDto.payment_gateway || PaymentGatewayType.FEEXPAY,
        order_status: OrderStatusType.PENDING,
        payment_status: PaymentStatusType.PENDING,
        children,
        delivery_fee: createOrderDto.delivery_fee || 0,
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
  async verifyOtp(dto: VerifyOtpDto, user: { id: number; permissions: string }) {
    const pool = this.databaseService.getPool();
console.log("user a verifié", user)
    // Récupérer l'order par id et otp_code
    const [rows]: any = await pool.query(
      `SELECT id, otp_code, otp_used, pickup_point_id, order_status
       FROM orders
       WHERE id = ? AND otp_code = ? LIMIT 1`,
      [dto.order_id, dto.otp_code]
    );

    if (!rows || rows.length === 0) {
      // aucun ordre avec cet id + otp
      throw new NotFoundException({ message: 'Code OTP invalide ou commande introuvable.' });
    }

    const order = rows[0];

    // Si OTP déjà utilisé -> refuse
    if (order.otp_used) {
      throw new BadRequestException({ message: 'Ce code OTP a déjà été utilisé.' });
    }

    // Vérifier que l'utilisateur est autorisé (super_pickuppoint) et que pickup_point_id correspond
    if (!user.permissions.includes('super_pickuppoint')) {
      throw new ForbiddenException({ message: "Vous n'êtes pas autorisé à effectuer cette opération." });
    }

    // Si l'order pickup_point_id n'est pas le même que l'id du user (ou me.pickup_point_id selon ton modèle)
    // Ici j’assume que le pickup_point_id est égal à user.id pour les super_pickuppoint.
    if (order.pickup_point_id !== user.id) {
      throw new ForbiddenException({ message: "Vous n'êtes pas autorisé à effectuer cette opération pour ce point relais." });
    }

    // Tout est OK -> marquer comme livré (order-completed) + delivered_at + otp_used = 1
    const [updateResult]: any = await pool.query(
      `UPDATE orders
       SET order_status = ?, otp_used = 1, otp_attempts = otp_attempts + 1, delivered_at = NOW()
       WHERE id = ?`,
      ['order-completed', order.id]
    );

    // Récupérer la commande à jour pour renvoyer
    const [updatedRows]: any = await pool.query(
      `SELECT * FROM orders WHERE id = ? LIMIT 1`,
      [order.id]
    );

    return { success: true, order: updatedRows[0] };
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
    WHERE pickup_point_id = ? AND is_archived = 0
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

  if (user.permissions?.includes('super_pickuppoint')) {
    where += ` AND pickup_point_id = ?`;
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
  if (user.permissions?.includes('super_pickuppoint')) {
    const [orderRows]: any = await pool.query(
      `SELECT pickup_point_id FROM orders WHERE id = ?`,
      [orderId]
    );

    const order = orderRows[0];

    if (!order || order.pickup_point_id !== user.id) {
      throw new ForbiddenException("Vous ne pouvez pas archiver cette commande");
    }
  }

  await pool.query(
    `UPDATE orders SET is_archived = 1 WHERE id = ?`,
    [orderId]
  );

  return { message: "Commande archivée" };
}

async unarchiveOrder(orderId: number) {
  const pool = this.databaseService.getPool();

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

  if (user.permissions === "super_pickuppoint") {
    where.push(`pickup_point_id = ?`);
    params.push(user.id);
  }

  const [rows]: any = await pool.query(
    `SELECT * FROM orders 
     WHERE ${where.join(" AND ")} 
     ORDER BY created_at DESC 
     LIMIT 20`,
    params
  );

  return rows;
}


// 📌 GET ORDERS (pickup + user normal)
// Compatible MySQL + pool.query
async getOrders(query: GetOrdersDto, user) {
  const pool = this.databaseService.getPool();

  const {
    limit = 15,
    page = 1,
    search,
    customer_id,
    pickup_point_id,
    orderBy = 'created_at',
    sortedBy = 'DESC',
  } = query;

  const offset = (page - 1) * limit;

  // ----------------------------
  // 🔐 Sécurité PickupPoint
  // ----------------------------
  if (user.permissions === 'super_pickuppoint') {
    if (+pickup_point_id !== user.id) {
      throw new ForbiddenException("Vous ne pouvez accéder qu'à vos commandes");
    }
  }

  // ----------------------------
  // 🔥 Base Query
  // ----------------------------
  let sql = `SELECT * FROM orders`;
  const params: any[] = [];

  const where: string[] = [`is_archived = 0`];  // 👈 support archive

  // Client filter
  if (customer_id) {
    where.push(`customer_id = ?`);
    params.push(customer_id);
  }

  // PickupPoint filter
  if (pickup_point_id) {
    where.push(`pickup_point_id = ?`);
    params.push(pickup_point_id);
  }

  // Search filter
  if (search) {
    where.push(`(
      tracking_number LIKE ?
      OR otp_code LIKE ?
      OR customer_name LIKE ?
      OR customer_contact LIKE ?
    )`);
    params.push(
      `%${search}%`,
      `%${search}%`,
      `%${search}%`,
      `%${search}%`
    );
  }

  if (where.length > 0) {
    sql += ` WHERE ` + where.join(' AND ');
  }

  // whitelist ORDER BY
  const allowedOrder = {
    created_at: 'created_at',
    total: 'total',
    updated_at: 'updated_at'
  };
  const safeOrderBy = allowedOrder[orderBy] || 'created_at';

  sql += ` ORDER BY ${safeOrderBy} ${sortedBy} LIMIT ? OFFSET ?`;
  params.push(Number(limit), Number(offset));

  const [rows]: any = await pool.query(sql, params);

  // COUNT
  let countSql = `SELECT COUNT(*) as total FROM orders WHERE ${where.join(' AND ')}`;
  const [count]: any = await pool.query(countSql, params.slice(0, params.length - 2));

  return {
    data: rows,
    total: count[0].total,
    page,
    last_page: Math.ceil(count[0].total / limit),
    next_page_url: page < Math.ceil(count[0].total / limit),
    prev_page_url: page > 1,
  };
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
          `SELECT id, name, email FROM users WHERE id = ? LIMIT 1`,
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

    console.log('DEBUG getOrderByIdOrTrackingNumber result order:', order);

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

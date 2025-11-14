import { Injectable } from '@nestjs/common';
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
  // GET ORDERS
  // =========================
  async getOrders(query: GetOrdersDto): Promise<OrderPaginator> {
    const pool = this.databaseService.getPool();
    const {
      limit = 15,
      page = 1,
      search,
      orderBy = QueryOrdersOrderByColumn.CREATED_AT,
      sortedBy = 'DESC',
    } = query;
    const offset = (page - 1) * limit;

    // whitelist orderBy
    const allowedOrderBy = {
      created_at: 'created_at',
      updated_at: 'updated_at',
      total: 'total',
    };
    const orderByColumn = allowedOrderBy[orderBy.toLowerCase()] || 'created_at';

    let sql = `SELECT * FROM orders`;
    const params: any[] = [];

    if (search) {
      sql += ` WHERE tracking_number LIKE ? OR customer_id IN (SELECT id FROM users WHERE email LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    sql += ` ORDER BY ${orderByColumn} ${sortedBy} LIMIT ? OFFSET ?`;
    params.push(Number(limit), Number(offset));

    const [rows]: any = await pool.query(sql, params);

    let countSql = `SELECT COUNT(*) as total FROM orders`;
    const countParams: any[] = [];
    if (search) {
      countSql += ` WHERE tracking_number LIKE ? OR customer_id IN (SELECT id FROM users WHERE email LIKE ?)`;
      countParams.push(`%${search}%`, `%${search}%`);
    }
    const [countRows]: any = await pool.query(countSql, countParams);
    const total = countRows[0].total;
    const last_page = Math.ceil(total / limit);

    return {
      data: rows,
      count: total,
      current_page: page,
      per_page: limit,
      total: total,
      firstItem: offset + 1,
      lastItem: offset + rows.length,
      last_page: last_page,
      first_page_url: `/orders?page=1`,
      last_page_url: `/orders?page=${last_page}`,
      next_page_url: page < last_page ? `/orders?page=${page + 1}` : null,
      prev_page_url: page > 1 ? `/orders?page=${page - 1}` : null,
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

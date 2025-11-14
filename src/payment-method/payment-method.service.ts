import { Injectable, NotFoundException } from '@nestjs/common';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';
import { DefaultCart } from './dto/set-default-card.dto';
import { StripePaymentService } from 'src/payment/stripe-payment.service';
import { SettingsService } from 'src/settings/settings.service';
import { AuthService } from 'src/auth/auth.service';
import { DatabaseService } from '../database/database.services';
import { PaymentGatewayType } from 'src/orders/entities/order.entity';
import { PaymentMethod } from './entities/payment-method.entity';
import { plainToClass } from 'class-transformer';

@Injectable()
export class PaymentMethodService {
  constructor(
    private readonly authService: AuthService,
    private readonly stripeService: StripePaymentService,
    private readonly settingService: SettingsService,
    private readonly db: DatabaseService,
  ) { }

  private async getUser() {
    const [rows] = await this.db.query('SELECT * FROM users LIMIT 1');
    return rows[0];
  }

  async create(createPaymentMethodDto: CreatePaymentMethodDto) {
    const user = await this.getUser();

    const [defaultCardRows] = await this.db.query(
      `SELECT * FROM payment_methods WHERE user_id = ? AND default_card = true LIMIT 1`,
      [user.id],
    );

    if (defaultCardRows.length === 0) {
      createPaymentMethodDto.default_card = true;
    } else if (createPaymentMethodDto.default_card) {
      await this.db.query(
        `UPDATE payment_methods SET default_card = false WHERE user_id = ?`,
        [user.id],
      );
    }

    const paymentGateway = PaymentGatewayType.STRIPE.toLowerCase();
    return this.saveCard(createPaymentMethodDto, paymentGateway);
  }

  async findAll() {
    const user = await this.getUser();
    const [rows] = await this.db.query(
      `SELECT * FROM payment_methods WHERE user_id = ?`,
      [user.id],
    );
    return rows.map((row) => plainToClass(PaymentMethod, row));
  }

  async findOne(id: number) {
    const [rows] = await this.db.query(
      `SELECT * FROM payment_methods WHERE id = ?`,
      [id],
    );
    const card = rows[0];
    if (!card) throw new NotFoundException('Carte non trouvée');
    return plainToClass(PaymentMethod, card);
  }

  async update(id: number, updateDto: UpdatePaymentMethodDto) {
    await this.db.query(
      `UPDATE payment_methods SET 
        method_key = COALESCE(?, method_key),
        default_card = COALESCE(?, default_card)
      WHERE id = ?`,
      [updateDto.method_key, updateDto.default_card, id],
    );

    return this.findOne(id);
  }

  async remove(id: number) {
    const card = await this.findOne(id);
    try {
      await this.stripeService.detachPaymentMethodFromCustomer(card.method_key);
    } catch (error: any) {
      console.error('Stripe detach error:', error.message);
    }
    await this.db.query(`DELETE FROM payment_methods WHERE id = ?`, [id]);
    return card;
  }

  async saveDefaultCart(defaultCart: DefaultCart) {
    const user = await this.getUser();
    await this.db.query(
      `UPDATE payment_methods SET default_card = false WHERE user_id = ?`,
      [user.id],
    );
    await this.db.query(
      `UPDATE payment_methods SET default_card = true WHERE id = ?`,
      [Number(defaultCart.method_id)],
    );
    return this.findOne(Number(defaultCart.method_id));
  }

  async savePaymentMethod(createPaymentMethodDto: CreatePaymentMethodDto) {
    const paymentGateway = PaymentGatewayType.STRIPE.toLowerCase();
    return this.saveCard(createPaymentMethodDto, paymentGateway);
  }

  async saveCard(createDto: CreatePaymentMethodDto, gateway: string) {
    const user = await this.getUser();

    const [existingDefault] = await this.db.query(
      `SELECT * FROM payment_methods WHERE user_id = ? AND default_card = true LIMIT 1`,
      [user.id],
    );

    if (existingDefault.length === 0) {
      createDto.default_card = true;
    }

    if (gateway === 'stripe') {
      const retrieved = await this.stripeService.retrievePaymentMethod(createDto.method_key);

      const [existing] = await this.db.query(
        `SELECT * FROM payment_methods WHERE fingerprint = ? LIMIT 1`,
        [retrieved.card.fingerprint],
      );

      if (existing.length > 0) {
        return plainToClass(PaymentMethod, existing[0]);
      }

      const customers = await this.stripeService.listAllCustomer();
      let customer = customers.data.find((c) => c.email === user.email);

      if (!customer) {
        customer = await this.stripeService.createCustomer({ name: user.name, email: user.email });
      }

      const attached = await this.stripeService.attachPaymentMethodToCustomer(
        createDto.method_key,
        customer.id,
      );

      // Get or create payment gateway
      const [gatewayRows] = await this.db.query(
        `SELECT * FROM payment_gateways WHERE user_id = ? AND gateway_name = ? LIMIT 1`,
        [user.id, gateway],
      );

      let gatewayRecord = gatewayRows[0];

      if (!gatewayRecord) {
        const [insertResult]: any = await this.db.query(
          `INSERT INTO payment_gateways (user_id, customer_id, gateway_name, created_at, updated_at)
           VALUES (?, ?, ?, NOW(), NOW())`,
          [user.id, customer.id, gateway],
        );

        const [created] = await this.db.query(
          `SELECT * FROM payment_gateways WHERE id = ?`,
          [insertResult.insertId],
        );

        gatewayRecord = created[0];
      }

      const [insertResult]: any = await this.db.query(
        `INSERT INTO payment_methods (
          method_key, payment_gateway_id, user_id, default_card, fingerprint, owner_name, last4,
          expires, network, type, origin, verification_check, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          createDto.method_key,
          gatewayRecord.id,
          user.id,
          createDto.default_card,
          attached.card.fingerprint,
          attached.billing_details.name,
          attached.card.last4,
          `${attached.card.exp_month}/${attached.card.exp_year}`,
          attached.card.brand,
          attached.card.funding,
          attached.card.country,
          attached.card.checks?.cvc_check || null,
        ],
      );

      const [inserted] = await this.db.query(
        `SELECT * FROM payment_methods WHERE id = ?`,
        [insertResult.insertId],
      );

      return plainToClass(PaymentMethod, inserted[0]);
    }
  }

  async validatePayment({
    userId,
    amount,
    status,
    reference,
  }: {
    userId: number | string;
    amount: number;
    status: string;
    reference?: string;
  }) {
    if (status !== 'successful') {
      console.warn(`Payment not successful: ${status}`);
      return;
    }

    // Enregistrer la transaction dans la base de données avec la référence
    await this.db.query(
      `INSERT INTO payments (user_id, amount, status, reference, created_at, updated_at)
     VALUES (?, ?, ?, ?, NOW(), NOW())`,
      [userId, amount, status, reference || null],
    );

    // Optionnel : créditer l'utilisateur ou déclencher une action
    console.log(
      `Paiement validé pour l'utilisateur ${userId} - montant : ${amount} - référence : ${reference}`,
    );
  }


}

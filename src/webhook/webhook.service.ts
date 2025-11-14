import { Injectable, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.services';
import { PaymentMethodService } from 'src/payment-method/payment-method.service'; // Ajuste le chemin si besoin

// Interface pour la validation du paiement, avec "reference" optionnel
interface ValidatePaymentDto {
  userId: string | number;
  amount: number;
  status: string;
  reference?: string | null;
}

@Injectable()
export class WebHookService {
  constructor(
    private readonly db: DatabaseService,
    private readonly paymentMethodService: PaymentMethodService,
  ) { }

  // Traitement webhook Flutterwave
  async handleFlutterwaveWebhook(body: any, signature: string): Promise<string> {
    const secretHash = process.env.FLUTTERWAVE_SECRET_HASH;

    if (!signature || signature !== secretHash) {
      throw new BadRequestException('Unauthorized webhook request');
    }

    if (!body || !body.data) {
      throw new BadRequestException('Invalid webhook data');
    }

    const data = body.data;
    const { customer, amount, currency, id: transaction_id, status, payment_type } = data;

    if (status !== 'successful') {
      return 'Transaction not successful. Ignored.';
    }

    const email = customer?.email;

    if (!email) {
      throw new BadRequestException('Customer email missing in webhook data');
    }

    // Insertion ou mise à jour de la méthode de paiement dans la base
    await this.db.query(
      `INSERT INTO payment_methods (user_email, provider, payment_type, currency, transaction_id, amount, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), amount = VALUES(amount)`,
      [email, 'flutterwave', payment_type || 'card', currency, transaction_id, amount, status],
    );

    // Appel au service principal de validation du paiement
    await this.paymentMethodService.validatePayment({
      userId: customer?.id,
      amount,
      status,
      reference: data.tx_ref || data.flw_ref || null,
    } as ValidatePaymentDto);

    return 'Webhook processed successfully';
  }

  // Traitement simplifié pour Razorpay
  async handleRazorPayWebhook(payload: any) {
    await this.paymentMethodService.validatePayment({
      userId: payload.customer?.id,
      amount: payload.amount,
      status: payload.status,
      reference: payload.reference || null,
    } as ValidatePaymentDto);
    return { message: 'Razorpay webhook handled' };
  }

  // Traitement simplifié pour Stripe
  async handleStripeWebhook(payload: any) {
    const obj = payload?.data?.object || {};
    await this.paymentMethodService.validatePayment({
      userId: obj.customer,
      amount: obj.amount,
      status: obj.status,
      reference: obj.id || null,
    } as ValidatePaymentDto);
    return { message: 'Stripe webhook handled' };
  }

  // Traitement simplifié pour Paypal
  async handlePaypalWebhook(payload: any) {
    await this.paymentMethodService.validatePayment({
      userId: payload.payer?.payer_id,
      amount: parseFloat(payload.purchase_units?.[0]?.amount?.value) || 0,
      status: payload.status,
      reference: payload.id || null,
    } as ValidatePaymentDto);
    return { message: 'Paypal webhook handled' };
  }
}

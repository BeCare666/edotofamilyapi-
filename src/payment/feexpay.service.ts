import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';
import {
  IPaymentGatewayService,
  PaymentInitDto,
  PaymentInitResponse,
} from 'src/payment-gateway/payment-gateway.interface';
import { Order, PaymentGatewayType } from 'src/orders/entities/order.entity';

@Injectable()
export class FeexpayService implements IPaymentGatewayService {
  private baseUrl = 'https://api.feexpay.com/v1';
  private secretKey = process.env.FEEXPAY_SECRET_KEY || '';
  private publicKey = process.env.FEEXPAY_PUBLIC_KEY || '';

  /**
   * =========================
   * INITIALIZE PAYMENT
   * =========================
   */
  async initializePayment(data: PaymentInitDto): Promise<PaymentInitResponse> {
    try {
      const reference = data.reference || `fxp_${Date.now()}`;

      // Corps adapté à la logique Feexpay (selon doc)
      const body = {
        amount: data.amount,
        currency: data.currency || 'XOF',
        reference,
        callback_url: data.metadata?.redirect_url || null,
        customer: {
          email: data.email,
          name: data.metadata?.name || 'Customer',
        },
        metadata: data.metadata || {},
      };

      const res = await axios.post(`${this.baseUrl}/payments/initiate`, body, {
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!res.data || !res.data.data?.checkout_url) {
        throw new HttpException('Invalid Feexpay response', HttpStatus.BAD_REQUEST);
      }

      return {
        gateway: 'feexpay',
        is_redirect: true,
        payment_id: res.data.data.transaction_id?.toString(),
        redirect_url: res.data.data.checkout_url,
        paymentData: {
          publicKey: this.publicKey,
          reference,
          amount: data.amount,
          currency: data.currency || 'XOF',
        },
      };
    } catch (err: any) {
      console.error(err.response?.data || err.message);
      throw new HttpException('Feexpay init failed', HttpStatus.BAD_REQUEST);
    }
  }

  /**
   * =========================
   * CREATE PAYMENT INTENT
   * =========================
   */
  async createPaymentIntent(order: Order): Promise<any> {
    return {
      id: Date.now(),
      order_id: order.id,
      tracking_number: order.tracking_number,
      payment_gateway: PaymentGatewayType.FEEXPAY,
      amount: order.total,
      currency: 'XOF',
      status: 'pending',
      payment_intent_info: {},
    };
  }

  /**
   * =========================
   * PAY METHOD (compatibilité)
   * =========================
   */
  async pay(order: Order): Promise<void> {
    console.log('Feexpay pay called for order:', order.tracking_number);
  }

  /**
   * =========================
   * VERIFY PAYMENT
   * =========================
   */
  async verifyPayment(reference: string) {
    try {
      const res = await axios.get(`${this.baseUrl}/payments/verify/${reference}`, {
        headers: { Authorization: `Bearer ${this.secretKey}` },
      });
      return res.data;
    } catch (err) {
      throw new HttpException('Feexpay verify failed', HttpStatus.BAD_REQUEST);
    }
  }
}

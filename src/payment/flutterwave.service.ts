import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';
import {
    IPaymentGatewayService,
    PaymentInitDto,
    PaymentInitResponse,
} from 'src/payment-gateway/payment-gateway.interface';
import { Order, PaymentGatewayType } from 'src/orders/entities/order.entity';

@Injectable()
export class FlutterwaveService implements IPaymentGatewayService {
    private baseUrl = 'https://api.flutterwave.com/v3';
    private secretKey = process.env.FLUTTERWAVE_SECRET_KEY || '';

    // =========================
    // INITIALIZE PAYMENT (appelé par front)
    // =========================
    async initializePayment(data: PaymentInitDto): Promise<PaymentInitResponse> {
        try {
            const tx_ref = data.reference || `fw_${Date.now()}`;
            const body = {
                tx_ref,
                amount: data.amount,
                currency: data.currency || 'XOF',
                redirect_url: data.metadata?.redirect_url || null,
                customer: {
                    email: data.email,
                    name: data.metadata?.name || 'Customer',
                },
                meta: data.metadata || {},
            };

            const res = await axios.post(`${this.baseUrl}/payments`, body, {
                headers: {
                    Authorization: `Bearer ${this.secretKey}`,
                    'Content-Type': 'application/json',
                },
            });

            return {
                gateway: 'flutterwave',
                is_redirect: true,
                payment_id: res.data.data.id?.toString(),
                redirect_url: res.data.data.link,
                paymentData: {
                    publicKey: process.env.FLUTTERWAVE_PUBLIC_KEY,
                    tx_ref,
                    amount: data.amount,
                    currency: data.currency || 'XOF',
                },
            };
        } catch (err: any) {
            console.error(err.response?.data || err.message);
            throw new HttpException('Flutterwave init failed', HttpStatus.BAD_REQUEST);
        }
    }

    // =========================
    // CREATE PAYMENT INTENT (appelé côté serveur par OrdersService)
    // =========================
    async createPaymentIntent(order: Order): Promise<any> {
        return {
            id: Date.now(),
            order_id: order.id,
            tracking_number: order.tracking_number,
            payment_gateway: PaymentGatewayType.FLUTTERWAVE,
            amount: order.total,
            currency: 'XOF',
            status: 'pending',
            payment_intent_info: {},
        };
    }

    // =========================
    // PAY METHOD (appelé par OrdersService pour compatibilité)
    // =========================
    async pay(order: Order): Promise<void> {
        console.log('Flutterwave pay called for order:', order.tracking_number);
        // Tu peux ici appeler initializePayment si tu veux créer le PaymentIntent côté serveur
    }

    // =========================
    // VERIFY PAYMENT (optionnel)
    // =========================
    async verifyPayment(reference: string) {
        try {
            const res = await axios.get(`${this.baseUrl}/transactions/${reference}/verify`, {
                headers: { Authorization: `Bearer ${this.secretKey}` },
            });
            return res.data;
        } catch (err) {
            throw new HttpException('Flutterwave verify failed', HttpStatus.BAD_REQUEST);
        }
    }
}

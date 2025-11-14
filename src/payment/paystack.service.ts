// npm install axios
import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';
import {
    IPaymentGatewayService,
    PaymentInitDto,
    PaymentInitResponse,
} from 'src/payment-gateway/payment-gateway.interface';

@Injectable()
export class PaystackService implements IPaymentGatewayService {
    private baseUrl = 'https://api.paystack.co';
    private secretKey = process.env.PAYSTACK_SECRET_KEY || '';

    async initializePayment(data: PaymentInitDto): Promise<PaymentInitResponse> {
        try {
            const reference = data.reference || `ps_${Date.now()}`;
            const res = await axios.post(
                `${this.baseUrl}/transaction/initialize`,
                {
                    email: data.email,
                    amount: Math.round(data.amount) * 100, // kobo/centimes (Paystack expects smallest currency unit)
                    reference,
                    metadata: data.metadata || {},
                },
                {
                    headers: { Authorization: `Bearer ${this.secretKey}` },
                },
            );

            return {
                gateway: 'paystack',
                is_redirect: false,
                payment_id: res.data.data.reference,
                paymentData: {
                    publicKey: process.env.PAYSTACK_PUBLIC_KEY,
                    reference: res.data.data.reference,
                    authorization_url: res.data.data.authorization_url,
                    access_code: res.data.data.access_code,
                    amount: data.amount,
                    email: data.email,
                },
            };
        } catch (err) {
            throw new HttpException('Paystack init failed', HttpStatus.BAD_REQUEST);
        }
    }

    async verifyPayment(reference: string) {
        try {
            const res = await axios.get(`${this.baseUrl}/transaction/verify/${reference}`, {
                headers: { Authorization: `Bearer ${this.secretKey}` },
            });
            return res.data;
        } catch (err) {
            throw new HttpException('Paystack verify failed', HttpStatus.BAD_REQUEST);
        }
    }
}

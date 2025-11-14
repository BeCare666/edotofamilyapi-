// src/payment-gateway/payment-gateway.interface.ts
export interface PaymentInitDto {
  amount: number;
  email: string;
  currency?: string;
  reference?: string; // facultatif, backend peut générer
  metadata?: any;
  callback_url?: string; // facultatif, URL de redirection après paiement
}

export interface PaymentInitResponse {
  id?: number;
  gateway: string; // 'flutterwave' | 'paystack' | ...
  is_redirect: boolean;
  payment_id?: string;
  client_secret?: string | null;
  redirect_url?: string | null;
  paymentData?: any; // données à renvoyer au frontend (public_key, tx_ref, etc.)
}

export interface IPaymentGatewayService {
  initializePayment(data: PaymentInitDto): Promise<PaymentInitResponse>;
  verifyPayment(reference: string): Promise<any>;
}

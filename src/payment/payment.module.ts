import { Module } from '@nestjs/common';
import { AuthModule } from 'src/auth/auth.module';
import { PaypalPaymentService } from './paypal-payment.service';
import { StripePaymentService } from './stripe-payment.service';
import { FlutterwaveService } from './flutterwave.service';
import { FeexpayService } from './feexpay.service';
import { PaystackService } from './paystack.service';

@Module({
  imports: [AuthModule],
  providers: [StripePaymentService, PaypalPaymentService, FlutterwaveService, PaystackService, FeexpayService],
  exports: [StripePaymentService, PaypalPaymentService, PaystackService, FlutterwaveService, FeexpayService],
})
export class PaymentModule { }

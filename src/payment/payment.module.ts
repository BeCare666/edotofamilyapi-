import { Module } from '@nestjs/common';
import { AuthModule } from 'src/auth/auth.module';
import { PaystackService } from './paystack.service';

@Module({
  imports: [AuthModule],
  // FeexpayService supprimé (30/10/2026) : jamais appelé, il visait api.feexpay.com/v1 qui n'existe pas.
  // Le paiement FeexPay passe par src/payment-intent (vérification feexpay-verify.ts).
  providers: [PaystackService],
  exports: [PaystackService],
})
export class PaymentModule { }

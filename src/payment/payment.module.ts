import { Module } from '@nestjs/common';
import { AuthModule } from 'src/auth/auth.module';
import { FeexpayService } from './feexpay.service';
import { PaystackService } from './paystack.service';

@Module({
  imports: [AuthModule],
  providers: [PaystackService, FeexpayService],
  exports: [PaystackService, FeexpayService],
})
export class PaymentModule { }

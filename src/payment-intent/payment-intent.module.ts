import { Module } from '@nestjs/common';
import { PaymentIntentController } from './payment-intent.controller';
import { PaymentIntentService } from './payment-intent.service';
import { PaymentModule } from 'src/payment/payment.module';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [PaymentModule, DatabaseModule],
  controllers: [PaymentIntentController],
  providers: [PaymentIntentService],
})
export class PaymentIntentModule { }

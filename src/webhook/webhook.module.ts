import { Module } from '@nestjs/common';
import { WebHookController } from './webhook.controller';
import { WebHookService } from './webhook.service';
import { PaymentMethodModule } from '../payment-method/payment-method.module'; // Assure-toi du chemin
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [PaymentMethodModule, DatabaseModule], // Import nécessaire pour avoir PaymentMethodService injectable
  controllers: [WebHookController],
  providers: [WebHookService],
})
export class WebHookModule { }

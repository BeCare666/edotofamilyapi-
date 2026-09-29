import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CourierLinksController, DeliveryAdminController, DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';

@Module({
  imports: [DatabaseModule],
  controllers: [DeliveryController, CourierLinksController, DeliveryAdminController],
  providers: [DeliveryService],
  exports: [DeliveryService],
})
export class DeliveryModule { }

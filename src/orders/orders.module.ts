import { Module } from '@nestjs/common';
import { AuthModule } from 'src/auth/auth.module';
import { PaymentModule } from 'src/payment/payment.module';
import {
  DownloadInvoiceController,
  OrderExportController,
  OrdersController,
  OrderStatusController,
} from './orders.controller';
import { OrdersService } from './orders.service';
import { RefundsController, RefundsService } from './refunds';
import { DatabaseModule } from 'src/database/database.module';
import { DeliveryModule } from 'src/delivery/delivery.module';
@Module({
  imports: [AuthModule, PaymentModule, DatabaseModule, DeliveryModule],
  controllers: [
    OrdersController,
    OrderStatusController,
    OrderExportController,
    DownloadInvoiceController,
    RefundsController,
  ],
  providers: [OrdersService, RefundsService],
  exports: [OrdersService],
})
export class OrdersModule { }

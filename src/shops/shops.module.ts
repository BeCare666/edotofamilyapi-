import { Module } from '@nestjs/common';
import { ShopsService } from './shops.service';
import {
  DisapproveShop,
  ShopsController,
  StaffsController,
  NewShopsController,
  DisapproveShopController,
  ApproveShopController,
} from './shops.controller';
import { DatabaseModule } from '../database/database.module'; // ✅ ici
@Module({
  imports: [DatabaseModule], // ✅ ici
  controllers: [
    ShopsController,
    StaffsController,
    DisapproveShop,
    DisapproveShopController,
    ApproveShopController,
    NewShopsController,
  ],
  providers: [ShopsService],
})
export class ShopsModule { }

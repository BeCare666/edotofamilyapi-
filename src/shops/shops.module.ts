import { Module } from '@nestjs/common';
import { ShopsService } from './shops.service';
import {
  DisapproveShop,
  FollowShopController,
  ShopsController,
  StaffsController,
  TopShopsController,
  FollowedShops,
  NearByShopController,
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
    TopShopsController,
    DisapproveShop,
    FollowShopController,
    FollowedShops,
    DisapproveShopController,
    ApproveShopController,
    NearByShopController,
    NewShopsController,
  ],
  providers: [ShopsService],
})
export class ShopsModule { }

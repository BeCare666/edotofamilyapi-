// src/become-seller/become-seller.module.ts
import { Module } from '@nestjs/common';
import { BecomeSellerService } from './become-seller.service';
import { BecomeSellerController } from './become-seller.controller';
import { DatabaseService } from '../database/database.services';

@Module({
  controllers: [BecomeSellerController],
  providers: [BecomeSellerService, DatabaseService],
  exports: [BecomeSellerService],
})
export class BecomeSellerModule { }

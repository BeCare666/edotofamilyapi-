import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CommissionsController } from './commissions.controller';
import { CommissionsService } from './commissions.service';
import { AdminWithdrawalsController, PickupWithdrawalsController, WithdrawalsService } from './withdrawals';

@Module({
  imports: [DatabaseModule],
  controllers: [CommissionsController, PickupWithdrawalsController, AdminWithdrawalsController],
  providers: [CommissionsService, WithdrawalsService],
  exports: [CommissionsService],
})
export class CommissionsModule { }

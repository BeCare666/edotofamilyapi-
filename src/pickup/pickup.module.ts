import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PickupAdminController } from './pickup-admin.controller';
import { PickupAdminService } from './pickup-admin.service';
import { PickupDashboardController } from './pickup-dashboard.controller';
import { PickupDashboardService } from './pickup-dashboard.service';

// Contrôleurs exposés : admin (validation des points) et dashboard du point de retrait ;
// pickup.controller.ts (non enregistré) reste inactif.
@Module({
  imports: [DatabaseModule],
  controllers: [PickupAdminController, PickupDashboardController],
  providers: [PickupAdminService, PickupDashboardService],
})
export class PickupModule { }

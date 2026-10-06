import { Module } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { CampaignsAdminController } from './campaigns-admin.controller';
import { CampaignsAdminService } from './campaigns-admin.service';
import { CampaignRequestsService } from './campaign-requests.service';
import { DatabaseService } from '../database/database.services';
import { DatabaseModule } from '../database/database.module';
@Module({
   imports: [DatabaseModule],
  controllers: [CampaignsController, CampaignsAdminController],
  providers: [CampaignsService, CampaignsAdminService, CampaignRequestsService, DatabaseService],
  exports: [CampaignsService, CampaignsAdminService],
})
export class CampaignsModule {}
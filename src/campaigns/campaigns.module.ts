import { Module } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { DatabaseService } from '../database/database.services';
import { DatabaseModule } from '../database/database.module';
@Module({
   imports: [DatabaseModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, DatabaseService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
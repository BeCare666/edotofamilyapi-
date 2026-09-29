import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { SponsorInvitationsController, SponsorSpaceController, SponsorsAdminController } from './sponsors.controller';
import { SponsorAccountService } from './sponsor-account.service';
import { SponsorSpaceService } from './sponsor-space.service';
import { SponsorExportsAdminService } from './sponsor-exports-admin.service';

@Module({
  imports: [DatabaseModule, CampaignsModule],
  controllers: [SponsorInvitationsController, SponsorSpaceController, SponsorsAdminController],
  providers: [SponsorAccountService, SponsorSpaceService, SponsorExportsAdminService],
})
export class SponsorsModule { }

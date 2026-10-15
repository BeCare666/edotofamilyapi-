import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { SponsorInvitationsController, SponsorSignupController, SponsorSpaceController, SponsorsAdminController } from './sponsors.controller';
import { SponsorProposalsService } from './sponsor-proposals.service';
import { SponsorLiveService } from './sponsor-live.service';
import { SponsorAccountService } from './sponsor-account.service';
import { SponsorSpaceService } from './sponsor-space.service';
import { SponsorExportsAdminService } from './sponsor-exports-admin.service';

@Module({
  imports: [DatabaseModule, CampaignsModule],
  controllers: [SponsorInvitationsController, SponsorSignupController, SponsorSpaceController, SponsorsAdminController],
  providers: [SponsorAccountService, SponsorSpaceService, SponsorExportsAdminService, SponsorProposalsService, SponsorLiveService],
})
export class SponsorsModule { }

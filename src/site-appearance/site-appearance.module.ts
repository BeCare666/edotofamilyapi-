import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SiteAppearanceController } from './site-appearance.controller';
import { SiteAppearanceService } from './site-appearance.service';
import { SiteInfoController, SiteInfoService } from './site-info';

@Module({
  imports: [DatabaseModule],
  controllers: [SiteAppearanceController, SiteInfoController],
  providers: [SiteAppearanceService, SiteInfoService],
})
export class SiteAppearanceModule {}

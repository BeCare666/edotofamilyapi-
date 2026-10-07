import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SiteAppearanceController } from './site-appearance.controller';
import { SiteAppearanceService } from './site-appearance.service';

@Module({
  imports: [DatabaseModule],
  controllers: [SiteAppearanceController],
  providers: [SiteAppearanceService],
})
export class SiteAppearanceModule {}

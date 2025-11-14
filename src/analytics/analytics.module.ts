import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { DatabaseModule } from 'src/database/database.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsCronService } from './analyticsCron.services';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [DatabaseModule, ScheduleModule.forRoot()],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsCronService],
})
export class AnalyticsModule { }

import { Module } from '@nestjs/common';
import { FeedbackController } from './feedbacks.controller';
import { FeedbackService } from './feedbacks.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [FeedbackController],
  providers: [FeedbackService],
})
export class FeedbackModule {}

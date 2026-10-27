import { Module } from '@nestjs/common';
import { QuestionController } from './questions.controller';
import { QuestionService } from './questions.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [QuestionController],
  providers: [QuestionService],
})
export class QuestionModule { }

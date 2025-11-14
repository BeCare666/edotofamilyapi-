import { Module } from '@nestjs/common';
import { FaqsController } from './faqs.controller';
import { FaqsService } from './faqs.service';
import { DatabaseModule } from 'src/database/database.module';
@Module({
  imports: [DatabaseModule], // 👈 ajouter ici 
  controllers: [FaqsController],
  providers: [FaqsService],
})
export class FaqsModule { }

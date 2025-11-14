import { Module } from '@nestjs/common';
import { TagsService } from './tags.service';
import { TagsController } from './tags.controller';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [DatabaseModule], // 👈 ajouter ici  
  controllers: [TagsController],
  providers: [TagsService],
})
export class TagsModule { }

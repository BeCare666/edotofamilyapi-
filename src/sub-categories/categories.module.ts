import { Module } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { DatabaseModule } from '../database/database.module';  // chemin selon ton arborescence

@Module({
  imports: [DatabaseModule],  // <-- IMPORT ici
  controllers: [CategoriesController],
  providers: [CategoriesService],
})
export class SubCategoriesModule { }

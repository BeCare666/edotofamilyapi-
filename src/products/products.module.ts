import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { DatabaseModule } from 'src/database/database.module';
import {
  ProductsController,
  PopularProductsController,
  ProductsStockController,
  DraftProductsController,
  ProductAliasController,
} from './products.controller';

@Module({
  imports: [DatabaseModule], // 👈 ajouter ici
  controllers: [
    ProductsController,
    PopularProductsController,
    ProductsStockController,
    DraftProductsController,
    ProductAliasController,
  ],
  providers: [ProductsService],
})
export class ProductsModule { }

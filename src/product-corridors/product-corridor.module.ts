import { Module } from '@nestjs/common';
import { ProductCorridorController } from './product-corridor.controller';
import { ProductCorridorService } from './product-corridor.service';
import { DatabaseService } from '../database/database.services';
import { DatabaseModule } from '../database/database.module';

@Module({
    imports: [DatabaseModule],
    controllers: [ProductCorridorController],
    providers: [ProductCorridorService, DatabaseService],
})
export class ProductCorridorModule { }

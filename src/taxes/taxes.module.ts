import { Module } from '@nestjs/common';
import { TaxesService } from './taxes.service';
import { TaxesController } from './taxes.controller';
import { DatabaseModule } from '../database/database.module';
@Module({
  imports: [DatabaseModule],
  controllers: [TaxesController],
  providers: [TaxesService],
})
export class TaxesModule { }

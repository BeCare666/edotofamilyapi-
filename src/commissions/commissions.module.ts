import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CommissionsController } from './commissions.controller';
import { CommissionsService } from './commissions.service';

@Module({
  imports: [DatabaseModule],
  controllers: [CommissionsController],
  providers: [CommissionsService],
  exports: [CommissionsService],
})
export class CommissionsModule { }

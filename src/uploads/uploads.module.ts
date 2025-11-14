import { Module } from '@nestjs/common';
import { UploadsController } from 'src/uploads/uploads.controller';
import { UploadsService } from './uploads.service';
import { DatabaseService } from '../database/database.services';

@Module({
  controllers: [UploadsController],
  providers: [UploadsService, DatabaseService],
})
export class UploadsModule { }

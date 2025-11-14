import { Module } from '@nestjs/common';
import { DatabaseSetupService } from './database-setup.service';
import { DatabaseService } from './database.services';

@Module({
    providers: [DatabaseSetupService, DatabaseService],
    exports: [DatabaseService],
})
export class DatabaseModule { }  

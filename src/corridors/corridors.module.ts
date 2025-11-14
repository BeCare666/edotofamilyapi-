import { Module } from '@nestjs/common';
import { CorridorsService } from './corridors.service';
import { CorridorsController } from './corridors.controller';
import { DatabaseModule } from '../database/database.module';

@Module({
    imports: [DatabaseModule],
    providers: [CorridorsService],
    controllers: [CorridorsController],
    exports: [CorridorsService],
})
export class CorridorsModule { }

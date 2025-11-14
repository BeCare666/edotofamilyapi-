// src/countries/countries.module.ts
import { Module } from '@nestjs/common';
import { CountriesService } from './countries.service';
import { CountriesController } from './countries.controller';
import { DatabaseModule } from '../database/database.module';

@Module({
    imports: [DatabaseModule],
    controllers: [CountriesController],
    providers: [CountriesService],
})
export class CountriesModule { }

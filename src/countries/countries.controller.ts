// src/countries/countries.controller.ts
import { Controller, Post, Body, Get, Param, Delete } from '@nestjs/common';
import { CountriesService } from './countries.service';
import { CreateCountryDto } from './dto/create-countries.dto';
import { SuperAdminOnly } from '../auth/super-admin-only.decorator';
import { Public } from '../auth/public.decorator';

@Controller('countries')
export class CountriesController {
    constructor(private readonly countriesService: CountriesService) { }

    @SuperAdminOnly()
    @Post()
    create(@Body() dto: CreateCountryDto) {
        return this.countriesService.createCountry(dto);
    }

    @Public()
    @Get()
    findAll() {
        return this.countriesService.findAll();
    }

    @Public()
    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.countriesService.findOne(Number(id));
    }

    @SuperAdminOnly()
    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.countriesService.remove(Number(id));
    }
}

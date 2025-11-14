// src/countries/countries.controller.ts
import { Controller, Post, Body, Get, Param, Delete } from '@nestjs/common';
import { CountriesService } from './countries.service';
import { CreateCountryDto } from './dto/create-countries.dto';

@Controller('countries')
export class CountriesController {
    constructor(private readonly countriesService: CountriesService) { }

    @Post()
    create(@Body() dto: CreateCountryDto) {
        return this.countriesService.createCountry(dto);
    }

    @Post('bulk')
    createMany(@Body() dtos: CreateCountryDto[]) {
        return this.countriesService.createMany(dtos);
    }

    @Get()
    findAll() {
        return this.countriesService.findAll();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.countriesService.findOne(Number(id));
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.countriesService.remove(Number(id));
    }
}

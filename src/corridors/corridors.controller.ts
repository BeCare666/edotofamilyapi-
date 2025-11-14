import { Controller, Get, Post, Body, Param, Patch, Delete } from '@nestjs/common';
import { CorridorsService } from './corridors.service';
import { CreateCorridorDto } from './dtos/create-corridor.dto';
import { UpdateCorridorDto } from './dtos/update-corridor.dto';

@Controller('corridors')
export class CorridorsController {
    constructor(private readonly corridorsService: CorridorsService) { }

    @Post()
    create(@Body() createDto: CreateCorridorDto) {
        return this.corridorsService.create(createDto);
    }

    @Get()
    findAll() {
        return this.corridorsService.findAll();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.corridorsService.findOne(id);
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() updateDto: UpdateCorridorDto) {
        return this.corridorsService.update(id, updateDto);
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.corridorsService.remove(id);
    }
}

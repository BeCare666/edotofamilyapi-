import { Controller, Get, Post, Body, Param, Patch, Delete } from '@nestjs/common';
import { CorridorsService } from './corridors.service';
import { CreateCorridorDto } from './dtos/create-corridor.dto';
import { UpdateCorridorDto } from './dtos/update-corridor.dto';
import { SuperAdminOnly } from '../auth/super-admin-only.decorator';
import { Public } from '../auth/public.decorator';

@Controller('corridors')
export class CorridorsController {
    constructor(private readonly corridorsService: CorridorsService) { }

    @SuperAdminOnly()
    @Post()
    create(@Body() createDto: CreateCorridorDto) {
        return this.corridorsService.create(createDto);
    }

    @Public()
    @Get()
    findAll() {
        return this.corridorsService.findAll();
    }

    @Public()
    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.corridorsService.findOne(id);
    }

    @SuperAdminOnly()
    @Patch(':id')
    update(@Param('id') id: string, @Body() updateDto: UpdateCorridorDto) {
        return this.corridorsService.update(id, updateDto);
    }

    @SuperAdminOnly()
    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.corridorsService.remove(id);
    }
}

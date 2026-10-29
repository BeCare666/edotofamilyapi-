import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { TypesService } from './types.service';
import { CreateTypeDto } from './dto/create-type.dto';
import { UpdateTypeDto } from './dto/update-type.dto';
import { GetTypesDto } from './dto/get-types.dto';
import { SuperAdminOnly } from '../auth/super-admin-only.decorator';
import { Public } from '../auth/public.decorator';
import { SensitiveAction } from '../auth/step-up';

@Controller('types')
export class TypesController {
  constructor(private readonly typesService: TypesService) {}

  @SuperAdminOnly()
  @Post()
  create(@Body() createTypeDto: CreateTypeDto) {
    return this.typesService.create(createTypeDto);
  }

  @Public()
  @Get()
  findAll(@Query() query: GetTypesDto) {
    return this.typesService.getTypes(query);
  }

  @Public()
  @Get(':slug')
  getTypeBySlug(@Param('slug') slug: string) {
    return this.typesService.getTypeBySlug(slug);
  }

  @SuperAdminOnly()
  @Put(':id')
  update(@Param('id') id: string, @Body() updateTypeDto: UpdateTypeDto) {
    return this.typesService.update(+id, updateTypeDto);
  }

  @SuperAdminOnly()
  @SensitiveAction() // audit 3.1 : code redemandé
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.typesService.remove(+id);
  }
}

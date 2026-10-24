import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { SousCategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { GetCategoriesDto } from './dto/get-categories.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { SuperAdminOnly } from '../auth/super-admin-only.decorator';
import { Public } from '../auth/public.decorator';

@Controller('souscategories')
export class CategoriesController {
  constructor(private readonly SousCategoriesService: SousCategoriesService) { }

  @SuperAdminOnly()
  @Post()
  create(@Body() createCategoryDto: CreateCategoryDto) {
    return this.SousCategoriesService.create(createCategoryDto);
  }
  @SuperAdminOnly()
  @Post('batch')
  async createBatch(@Body() dtos: CreateCategoryDto[]) {
    return this.SousCategoriesService.createMany(dtos);
  }

  @Public()
  @Get()
  findAll(@Query() query: GetCategoriesDto) {
    return this.SousCategoriesService.getCategories(query);
  }
  @Public()
  @Get('bycategory')
  async listByCategory(@Query('categories_id') categories_id: string) {
    if (!categories_id) {
      throw new BadRequestException('categories_id query param is required');
    }
    const categoryId = Number(categories_id);
    if (Number.isNaN(categoryId)) {
      throw new BadRequestException('categories_id must be a number');
    }

    const rows = await this.SousCategoriesService.findByCategoryId(categoryId);
    return { data: rows };
  }
  @Public()
  @Get(':param')
  findOne(@Param('param') param: string, @Query('language') language: string) {
    return this.SousCategoriesService.getCategory(param, language);
  }

  @SuperAdminOnly()
  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
  ) {
    return this.SousCategoriesService.update(+id, updateCategoryDto);
  }

  @SuperAdminOnly()
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.SousCategoriesService.remove(+id);
  }
}

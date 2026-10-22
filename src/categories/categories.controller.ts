import { Controller, Get, Post, Body, Patch, Param, Query, Delete } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { GetCategoriesDto } from './dto/get-categories.dto';
import { SuperAdminOnly } from '../auth/super-admin-only.decorator';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) { }

  @SuperAdminOnly()
  @Post()
  create(@Body() createCategoryDto: CreateCategoryDto) {
    return this.categoriesService.create(createCategoryDto);
  }

  @SuperAdminOnly()
  @Post('bulk')
  createMany(@Body() categories: CreateCategoryDto[]) {
    return this.categoriesService.createMany(categories);
  }

  @Get()
  findAll(@Query() query: GetCategoriesDto) {
    return this.categoriesService.getCategories(query);
  }

  @Get(':param')
  findOne(@Param('param') param: string, @Query('language') language: string) {
    return this.categoriesService.getCategory(param, language);
  }

  @SuperAdminOnly()
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateCategoryDto: UpdateCategoryDto) {
    return this.categoriesService.update(Number(id), updateCategoryDto);
  }

  @SuperAdminOnly()
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.categoriesService.remove(Number(id));
  }
}

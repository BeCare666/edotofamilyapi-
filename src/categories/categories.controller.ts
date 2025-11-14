import { Controller, Get, Post, Body, Patch, Param, Query, Delete } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { GetCategoriesDto } from './dto/get-categories.dto';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) { }

  @Post()
  create(@Body() createCategoryDto: CreateCategoryDto) {
    return this.categoriesService.create(createCategoryDto);
  }

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

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateCategoryDto: UpdateCategoryDto) {
    return this.categoriesService.update(Number(id), updateCategoryDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.categoriesService.remove(Number(id));
  }
}

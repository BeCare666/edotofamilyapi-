import { PickType } from '@nestjs/swagger';
import { Category } from '../entities/category.entity';

export class CreateCategoryDto extends PickType(Category, [
  'name',
  'type',
  'slug',
  'details',
  'categories_id',
  'parent_id',
  'icon',
  'language',
  'parent',

]) { }

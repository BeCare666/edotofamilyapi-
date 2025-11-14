import { IsString, IsOptional, IsNumber, IsBoolean, IsObject, IsNotEmpty, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Transform } from 'class-transformer';
class ProductCategoryItem {
  @IsNumber()
  categories_id: number;

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  sous_categories_id?: number[];

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  sub_categories_id?: number[];
}

export class CreateProductDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsNumber()
  owner_id?: number;

  @IsOptional()
  @IsNumber()
  countries_id?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  type_id?: number;

  @IsOptional()
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsNumber()
  shop_id?: number;

  @IsOptional()
  @IsNumber()
  sale_price?: number;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsNumber()
  min_price?: number;

  @IsOptional()
  @IsNumber()
  max_price?: number;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsString()
  preview_url?: string;

  @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsOptional()
  @IsBoolean()
  in_stock?: boolean;

  @IsOptional()
  @IsBoolean()
  is_taxable?: boolean;

  @IsOptional()
  @IsNumber()
  shipping_class_id?: number;

  @IsOptional()
  @IsString()
  product_type?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsNumber()
  height?: number;

  @IsOptional()
  @IsNumber()
  width?: number;

  @IsOptional()
  @IsNumber()
  length?: number;

  @IsOptional()
  @IsObject()
  image?: any;

  @IsOptional()
  @IsObject()
  video?: any;

  @IsOptional()
  @IsArray()
  gallery?: any[];

  @IsOptional()
  @IsNumber()
  author_id?: number;

  @IsOptional()
  @IsNumber()
  manufacturer_id?: number;

  @IsOptional()
  @IsBoolean()
  is_digital?: boolean;

  @IsOptional()
  @IsBoolean()
  is_external?: boolean;

  @IsOptional()
  @IsString()
  external_product_url?: string;

  @IsOptional()
  @IsString()
  external_product_button_text?: string;

  @IsOptional()
  @IsNumber()
  orders_count?: number;

  @IsOptional()
  @IsNumber()
  ratings?: number;

  @IsOptional()
  @IsNumber()
  total_reviews?: number;

  @IsOptional()
  @IsObject()
  rating_count?: any;

  @IsOptional()
  @IsObject()
  my_review?: any;

  @IsOptional()
  @IsBoolean()
  in_wishlist?: boolean;

  @IsOptional()
  @IsNumber()
  total_downloads?: number;

  @IsOptional()
  @IsObject()
  blocked_dates?: any;

  @IsOptional()
  @IsObject()
  translated_languages?: any;

  @IsOptional()
  @IsObject()
  shop?: any;

  @IsOptional()
  @IsArray()
  tags?: any[];

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsObject()
  type?: any;

  @IsOptional()
  @IsArray()
  categories?: ProductCategoryItem[];

  @IsOptional()
  @IsObject()
  digital_file?: any;
  
  @IsNotEmpty()
  @IsBoolean()
  @Transform(({ value }) => value === true || value === 'true')
  is_origin: boolean;
}

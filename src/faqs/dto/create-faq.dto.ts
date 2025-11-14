import { PickType } from '@nestjs/swagger';
import { Faq } from '../entities/faq.entity';
import { IsOptional, IsString, IsArray, IsInt } from 'class-validator';

export class CreateFaqDto extends PickType(Faq, [
  'faq_title',
  'faq_description',
]) {
  @IsOptional()
  @IsString()
  faq_type?: string;

  @IsOptional()
  @IsString()
  issued_by?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsArray()
  translated_languages?: string[];

  @IsOptional()
  @IsInt()
  shop_id?: number;
}

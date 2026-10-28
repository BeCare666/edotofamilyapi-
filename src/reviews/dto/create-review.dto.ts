import { IsArray, IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';
import { Attachment } from '../../common/entities/attachment.entity';

// Audit sécurité 2.3 (28/10/2026, lot 5) : champs lus par ReviewsService.create ; photos est
// enregistré en JSON.
@StrictDto()
export class CreateReviewDto {
  @IsOptional() @IsScalar() rating: number;
  @IsOptional() @IsScalar() comment: string;
  @IsOptional() @IsArray() photos?: Attachment[];
  @IsOptional() @IsScalar() product_id: number;
  @IsOptional() @IsScalar() shop_id: number;
  @IsOptional() @IsScalar() order_id: number;
  @IsOptional() @IsScalar() variation_option_id?: number;
}

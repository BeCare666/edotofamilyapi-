import { IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';
import { CreateReviewDto } from './create-review.dto';

// Audit sécurité 2.3 (28/10/2026, lot 5) : champs écrits par ReviewsService.update ; my_feedback
// est enregistré en JSON.
@StrictDto()
export class UpdateReviewDto extends CreateReviewDto {
  @IsOptional() @IsScalar() positive_feedbacks_count?: number;
  @IsOptional() @IsScalar() negative_feedbacks_count?: number;
  @IsOptional() @IsScalar() abusive_reports_count?: number;
  @IsOptional() my_feedback?: any;
}

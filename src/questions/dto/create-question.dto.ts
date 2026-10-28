import { IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';

// Audit sécurité 2.3 (28/10/2026, lot 5) : champs lus par QuestionsService.create ; user_id est
// fixé par le contrôleur (utilisateur connecté), jamais repris du corps.
@StrictDto()
export class CreateQuestionDto {
  @IsOptional() @IsScalar() shop_id: number;
  @IsOptional() @IsScalar() product_id: number;
  @IsOptional() @IsScalar() question?: string;
  @IsOptional() @IsScalar() answer?: string;
}

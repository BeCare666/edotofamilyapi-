import { IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';

// Audit sécurité 2.3 (28/10/2026, lot 5) : QuestionsService.update n'écrit que question et answer.
@StrictDto()
export class UpdateQuestionDto {
  @IsOptional() @IsScalar() question?: string;
  @IsOptional() @IsScalar() answer?: string;
}

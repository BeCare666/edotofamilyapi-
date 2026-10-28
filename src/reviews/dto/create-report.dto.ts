import { IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';

// Audit sécurité 2.3 (28/10/2026, lot 5) : ReportsService ne lit pas le corps (réponse fixe) ;
// champs de l'entité Report déclarés pour ne pas encombrer le journal.
@StrictDto()
export class CreateReportDto {
  @IsOptional() @IsScalar() model_id: number;
  @IsOptional() @IsScalar() model_type: string;
  @IsOptional() @IsScalar() message: string;
}

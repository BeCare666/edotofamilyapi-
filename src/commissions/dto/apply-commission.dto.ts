import { IsArray, IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';

// Audit sécurité 2.3 (28/10/2026, lot 7) : PUT /admin/commissions/:type (admin commissions/index.tsx).
// parseCommissionValue et parseScope restent les contrôles métier.
@StrictDto()
export class ApplyCommissionDto {
  @IsOptional() @IsScalar() value: number;
  @IsOptional() @IsScalar() scope: string;
  @IsOptional() @IsArray() @IsScalar({ each: true }) pickup_point_ids?: number[];
}

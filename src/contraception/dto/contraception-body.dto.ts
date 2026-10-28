import { IsOptional, ValidateBy } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';

// Audit sécurité 2.3 (28/10/2026, lot 9) : corps des routes contraception. Les contrôles métier
// (cleanText, cleanList, parseMethod) restent dans ContraceptionService.

// Site pages/contraception/[slug].js
@StrictDto()
export class ContraceptionRequestDto {
  @IsOptional() @IsScalar() method_id: number;
  @IsOptional() @IsScalar() note?: string;
}

// Site MyContraception.jsx et admin contraception/index.tsx (suivis)
@StrictDto()
export class ContraceptionFollowupDto {
  @IsOptional() @IsScalar() content: string;
}

// Admin contraception/index.tsx
@StrictDto()
export class ContraceptionAcceptDto {
  @IsOptional() @IsScalar() note?: string;
  @IsOptional() @IsScalar() center_id?: number | string;
}

@StrictDto()
export class ContraceptionRefuseDto {
  @IsOptional() @IsScalar() reason: string;
}

// Admin contraception/methods.tsx (listes envoyées en tableaux de lignes, ou en texte)
function IsListOrText(): PropertyDecorator {
  return ValidateBy({
    name: 'isListOrText',
    validator: {
      validate: (v) =>
        typeof v === 'string' || (Array.isArray(v) && v.every((x) => x === null || ['string', 'number'].includes(typeof x))),
      defaultMessage: (args) => `${args?.property} : valeur invalide.`,
    },
  });
}

@StrictDto()
export class ContraceptionMethodDto {
  @IsOptional() @IsScalar() slug?: string;
  @IsOptional() @IsScalar() name: string;
  @IsOptional() @IsScalar() family?: string;
  @IsOptional() @IsScalar() requires_doctor?: boolean | number | string;
  @IsOptional() @IsScalar() summary?: string;
  @IsOptional() @IsScalar() description?: string;
  @IsOptional() @IsScalar() how_to?: string;
  @IsOptional() @IsListOrText() advantages?: string[] | string;
  @IsOptional() @IsListOrText() drawbacks?: string[] | string;
  @IsOptional() @IsListOrText() criteria?: string[] | string;
  @IsOptional() @IsScalar() efficacy?: string;
  @IsOptional() @IsScalar() duration?: string;
  @IsOptional() @IsScalar() protects_sti?: boolean | number | string;
  @IsOptional() @IsScalar() image_url?: string;
  @IsOptional() @IsScalar() image_credit?: string;
  @IsOptional() @IsScalar() sort_order?: number | string;
}

@StrictDto()
export class ContraceptionMethodActiveDto {
  @IsOptional() @IsScalar() active: boolean;
}

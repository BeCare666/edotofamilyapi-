// src/countries/dto/create-country.dto.ts
import { IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';

// Audit sécurité 2.3 (28/10/2026, lot 4) : champs lus par CountriesService.createCountry.
@StrictDto()
export class CreateCountryDto {
    @IsOptional() @IsScalar() name: string;
    @IsOptional() @IsScalar() slug: string;
    @IsOptional() @IsScalar() code: string;         // ex: BJ
    @IsOptional() @IsScalar() iso3?: string;        // ex: BEN
    @IsOptional() @IsScalar() phone_code?: string;  // ex: +229
    @IsOptional() @IsScalar() currency?: string;    // ex: XOF
    @IsOptional() @IsScalar() continent?: string;   // ex: Africa
    @IsOptional() @IsScalar() flag_url?: string;    // ex: https://flagcdn.com/bj.svg
    @IsOptional() @IsScalar() emoji?: string;
}

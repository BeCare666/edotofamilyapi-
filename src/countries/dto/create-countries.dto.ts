// src/countries/dto/create-country.dto.ts
export class CreateCountryDto {
    name: string;
    slug: string;
    code: string;         // ex: BJ
    iso3?: string;        // ex: BEN
    phone_code?: string;  // ex: +229
    currency?: string;    // ex: XOF
    continent?: string;   // ex: Africa
    flag_url?: string;    // ex: https://flagcdn.com/bj.svg
    emoji?: string;
}

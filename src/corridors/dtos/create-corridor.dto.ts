import { IsInt, IsOptional, IsString, IsNumber } from 'class-validator';

export class CreateCorridorDto {
    @IsInt()
    from_countries_id: number;

    @IsInt()
    to_countries_id: number;

    @IsString()
    douanes: string;

    @IsString()
    from_countries_code: string;

    @IsString()
    to_countries_code: string;

    @IsNumber()
    from_latitude: number;

    @IsNumber()
    from_longitude: number;

    @IsNumber()
    to_latitude: number;

    @IsNumber()
    to_longitude: number;

    @IsString()
    taxes: string;

    @IsString()
    logistique: string;
}

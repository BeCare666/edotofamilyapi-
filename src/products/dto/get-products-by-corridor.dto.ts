import { IsOptional, IsString, IsNumber, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export class GetProductsByCorridorDto {
    @IsOptional()
    @Type(() => Number)
    corridor_id?: number;

    @IsOptional()
    @Type(() => Number)
    countries_id?: number;

    @IsOptional()
    @IsString()
    categories_id?: number;

    @IsOptional()
    is_origin?: boolean;

    @IsOptional()
    @IsString()
    search?: string;

    @IsOptional()
    @Type(() => Number)
    limit?: number;

    @IsOptional()
    @Type(() => Number)
    offset?: number;

    @IsOptional()
    @IsString()
    orderBy?: string;

    @IsOptional()
    @IsString()
    sortedBy?: 'asc' | 'desc';


    @IsOptional()
    @Type(() => Number)
    sous_categories_id?: number;


    @IsOptional()
    @Type(() => Number)
    sub_categories_id?: number;

}

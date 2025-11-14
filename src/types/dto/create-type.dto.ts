import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateTypeDto {
    @IsNotEmpty()
    @IsString()
    name: string;

    @IsOptional()
    @IsString()
    slug?: string;

    @IsOptional()
    @IsString()
    icon?: string;

    @IsOptional()
    @IsString()
    language?: string;
}

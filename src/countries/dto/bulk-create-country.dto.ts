import { Type } from 'class-transformer';
import { ValidateNested, ArrayMinSize } from 'class-validator';
import { CreateCountryDto } from './create-countries.dto';

export class BulkCreateCountryDto {
    @ValidateNested({ each: true })
    @Type(() => CreateCountryDto)
    @ArrayMinSize(1)
    countries: CreateCountryDto[];
}

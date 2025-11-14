import { IsInt, IsArray, ArrayNotEmpty, ArrayUnique } from 'class-validator';
import { Type } from 'class-transformer';

export class LinkProductCorridorsDto {
    productId: number;
    corridorIds: number[];
}


import { ApiProperty } from '@nestjs/swagger';

export class CreateSponsorDto {
    @ApiProperty()
    name!: string;

    @ApiProperty()
    email!: string;

    @ApiProperty({ required: false, default: 0 })
    amount?: number;
}
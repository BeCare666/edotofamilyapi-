import { IsNumber } from 'class-validator';

export class UpdateAnalyticsDto {
    @IsNumber()
    amount: number;
}

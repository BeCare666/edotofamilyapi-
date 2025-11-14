// create-feedback.dto.ts
import { PickType, ApiProperty } from '@nestjs/swagger';
import { Feedback } from '../entities/feedback.entity';
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateFeedBackDto extends PickType(Feedback, [
  'model_id',
  'model_type',
  'positive',
  'negative',
] as const) {
  @ApiProperty({ description: "ID de l'utilisateur qui poste le feedback" })
  @IsNumber()
  @IsNotEmpty()
  user_id!: number;       // obligatoire

  @ApiProperty({ description: "ID du produit concerné par le feedback" })
  @IsNumber()
  @IsNotEmpty()
  product_id!: number;    // obligatoire

  @ApiProperty({ description: "Commentaire facultatif du feedback", required: false })
  @IsString()
  @IsOptional()
  comment?: string;       // optionnel
}

import { ApiProperty } from '@nestjs/swagger';
import { CreateSponsorDto } from './create-sponsor.dto';

export class CreateCampaignDto {
  @ApiProperty()
  title!: string;

  @ApiProperty({ required: false })
  description?: string;

  @ApiProperty({ required: false })
  image_url?: string;

  @ApiProperty()
  location!: string;

  @ApiProperty({
    example: '2026-03-25'
  })
  date_start!: string;

  @ApiProperty({
    required: false,
    nullable: true,
    example: '2026-03-30'
  })
  date_end?: string | null;

  @ApiProperty({
    required: false,
    enum: ['a_venir', 'planifie', 'en_cours'],
    default: 'a_venir'
  })
  status?: 'a_venir' | 'planifie' | 'en_cours';

  @ApiProperty({
    required: false,
    default: 0
  })
  objective_kits?: number;

  // ✅ FIX CRITIQUE ICI
  @ApiProperty({
    type: () => [CreateSponsorDto],
    required: false
  })
  sponsors?: CreateSponsorDto[];
}
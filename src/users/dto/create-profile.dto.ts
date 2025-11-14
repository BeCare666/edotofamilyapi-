import { PickType, PartialType } from '@nestjs/swagger';
import { Profile } from '../entities/profile.entity';

// Relation belongsTo
export class ConnectBelongsTo {
  connect: number;
}

// DTO pour création de profil
export class CreateProfileDto extends PartialType(
  PickType(Profile, ['avatar', 'bio', 'socials', 'contact'] as const)
) {
  customer?: ConnectBelongsTo;
}
// DTO pour mise à jour de profil
export class UpdateProfileDto extends PartialType(
  PickType(Profile, ['avatar', 'bio', 'socials', 'contact'] as const)
) {
  customer?: ConnectBelongsTo;
}
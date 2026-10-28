import { IsObject, IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';
import { SettingsOptions } from '../entities/setting.entity';

// Audit sécurité 2.3 (28/10/2026, lot 4) : l'admin envoie { language, options } ; SettingsService
// enregistre options en JSON (contenu non filtré, réglages du site) et language.
@StrictDto()
export class CreateSettingDto {
  @IsOptional() @IsObject() options: SettingsOptions;
  @IsOptional() @IsScalar() language: string;
}

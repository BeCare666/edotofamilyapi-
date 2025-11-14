import { PickType } from '@nestjs/swagger';
import { TermsAndConditions } from '../entities/terms-and-conditions.entity';

export class CreateTermsAndConditionsDto extends PickType(TermsAndConditions, [
  'title',
  'description',
  'language',
  'issued_by',
  'is_approved',
  'type',
  'translated_languages',
]) {
  shop_id?: number; // on passe seulement l'id du shop
}

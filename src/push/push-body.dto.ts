import { IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';

// Corps des routes des notifications push (04/11/2026). Contrôles de forme et de longueur dans PushController.

// Site lib/push.js : abonnement fourni par le navigateur (PushSubscription), mis à plat
@StrictDto()
export class PushSubscribeDto {
  @IsOptional() @IsScalar() endpoint: string;
  @IsOptional() @IsScalar() p256dh: string;
  @IsOptional() @IsScalar() auth: string;
  // Correction A2 (05/11/2026) : renvoi discret par le site quand le téléphone se croit abonné, sans notification d'activation
  @IsOptional() @IsScalar() resync: boolean;
}

@StrictDto()
export class PushUnsubscribeDto {
  @IsOptional() @IsScalar() endpoint: string;
}

// Site Paramètres (05/11/2026, décision P4) : notifications par sujet
@StrictDto()
export class PushPreferencesDto {
  @IsOptional() @IsScalar() orders: boolean;
  @IsOptional() @IsScalar() appointments: boolean;
  @IsOptional() @IsScalar() campaigns: boolean;
}

// Site dashboard jeune, Ma contraception : rappel à rythme libre
@StrictDto()
export class ContraceptionReminderDto {
  @IsOptional() @IsScalar() rhythm: string;
  @IsOptional() @IsScalar() time_hm: string;
  @IsOptional() @IsScalar() start_date: string;
}

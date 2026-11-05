import { IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';

// Corps des routes des notifications push (04/11/2026). Contrôles de forme et de longueur dans PushController.

// Site lib/push.js : abonnement fourni par le navigateur (PushSubscription), mis à plat
@StrictDto()
export class PushSubscribeDto {
  @IsOptional() @IsScalar() endpoint: string;
  @IsOptional() @IsScalar() p256dh: string;
  @IsOptional() @IsScalar() auth: string;
}

@StrictDto()
export class PushUnsubscribeDto {
  @IsOptional() @IsScalar() endpoint: string;
}

// Site dashboard jeune, Ma contraception : rappel à rythme libre
@StrictDto()
export class ContraceptionReminderDto {
  @IsOptional() @IsScalar() rhythm: string;
  @IsOptional() @IsScalar() time_hm: string;
  @IsOptional() @IsScalar() start_date: string;
}

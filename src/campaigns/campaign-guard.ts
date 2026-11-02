import { createHash } from 'crypto';
import { realClientIp } from '../common/client-ip';
import { settingOn } from '../platform-settings/platform-settings.store';

// Une seule demande de kit par personne et par campagne (demande du 06/10/2026), même en changeant
// de compte. Chaque demande enregistre des « marques » : compte, e-mail, appareil (identifiant tiré
// au hasard et conservé par le navigateur), empreinte du navigateur et adresse IP. Une nouvelle
// demande qui partage une seule de ces marques avec une demande existante de la même campagne est
// refusée. La table campaign_registration_guards a une clé primaire (campagne, type, empreinte) :
// deux demandes simultanées ne peuvent pas passer toutes les deux.
// Seules des empreintes SHA-256 sont stockées (jamais l'IP ni l'identifiant en clair).
//
// Interrupteurs (variables d'environnement), actifs par défaut :
//   CAMPAIGN_GUARD_IP=off           → ne plus bloquer par adresse IP
//   CAMPAIGN_GUARD_FINGERPRINT=off  → ne plus bloquer par empreinte du navigateur
export type GuardKind = 'user' | 'email' | 'device' | 'fingerprint' | 'ip';

export interface GuardInput {
  userId: number;
  email: string;
  deviceId?: unknown;
  fingerprint?: unknown;
  ip?: string | null;
}

export interface GuardKey {
  kind: GuardKind;
  hash: string;
}

const DEVICE_ID_RE = /^[A-Za-z0-9-]{16,64}$/;
const FINGERPRINT_RE = /^[a-f0-9]{64}$/;

export const guardHash = (kind: GuardKind, value: string) => createHash('sha256').update(`${kind}:${value}`).digest('hex');

// IP et empreinte : réglables par le super admin (02/11/2026, Paramètres → Avancés) ; les variables ci-dessus servent de valeur par défaut

// Adresse du client : CF-Connecting-IP posé par Cloudflare, sinon la connexion (voir common/client-ip.ts)
export function clientIpFrom(req: any): string | null {
  return realClientIp(req);
}

export function buildGuardKeys(input: GuardInput): GuardKey[] {
  const keys: GuardKey[] = [
    { kind: 'user', hash: guardHash('user', String(input.userId)) },
    { kind: 'email', hash: guardHash('email', String(input.email).trim().toLowerCase()) },
  ];
  if (typeof input.deviceId === 'string' && DEVICE_ID_RE.test(input.deviceId)) {
    keys.push({ kind: 'device', hash: guardHash('device', input.deviceId) });
  }
  if (settingOn('campaign.guard_fingerprint') && typeof input.fingerprint === 'string' && FINGERPRINT_RE.test(input.fingerprint)) {
    keys.push({ kind: 'fingerprint', hash: guardHash('fingerprint', input.fingerprint) });
  }
  if (settingOn('campaign.guard_ip') && input.ip) {
    keys.push({ kind: 'ip', hash: guardHash('ip', input.ip) });
  }
  return keys;
}

export const ALREADY_REGISTERED_MESSAGE = 'Vous avez déjà demandé un kit pour cette campagne. Une seule demande est possible par personne.';
export const SAME_DEVICE_MESSAGE =
  'Un kit de cette campagne a déjà été demandé depuis cet appareil ou cette connexion. Une seule demande est possible par personne.';

// Message selon la marque déjà utilisée : compte / e-mail, ou appareil / connexion
export function guardMessage(kinds: string[]): string {
  return kinds.some((k) => k === 'user' || k === 'email') ? ALREADY_REGISTERED_MESSAGE : SAME_DEVICE_MESSAGE;
}

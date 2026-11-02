import { BadRequestException } from '@nestjs/common';

/**
 * Paramètres avancés du super admin (02/11/2026, migration 027, rapports/PROPOSITION_PARAMETRES_SUPER_ADMIN.md).
 * Règles métier qui étaient codées en dur ou posées sur Render : chaque valeur par défaut est celle en vigueur
 * avant ce chantier (rien ne change tant que le super admin ne modifie rien). Bornes contrôlées ici.
 * Les valeurs enregistrées sont gardées en mémoire (lecture immédiate, sans requête), rechargées au démarrage,
 * après chaque modification et toutes les minutes.
 * Fichier sans dépendance vers les modules métier (évite les imports circulaires) : les valeurs par défaut
 * reprennent les constantes d'origine, qui restent exportées pour les tests.
 */
export type SettingGroup = 'teleconsultation' | 'campaigns' | 'orders' | 'contraception' | 'signup' | 'sponsors' | 'ai' | 'files';

export type SettingDef = {
  key: string;
  group: SettingGroup;
  label: string;
  help: string;
  type: 'int' | 'bool';
  unit?: string;
  min?: number;
  max?: number;
  /** Valeur en vigueur quand rien n'est enregistré (constante d'origine ou variable Render) */
  fallback: () => number | boolean;
  /** Visible par le site (GET /platform-settings) */
  public?: boolean;
};

const envOff = (name: string) => String(process.env[name] ?? '').toLowerCase() === 'off';

export const GROUP_LABELS: Record<SettingGroup, string> = {
  teleconsultation: 'Téléconsultation',
  campaigns: 'Campagnes et kits',
  orders: 'Commandes et livraison',
  contraception: 'Contraception',
  signup: 'Inscription',
  sponsors: 'Sponsors',
  ai: 'Assistant IA',
  files: 'Fichiers envoyés',
};

export const SETTING_DEFS: SettingDef[] = [
  // Téléconsultation (teleconsultation/tc-rules.ts, teleconsultation.service.ts, tc-reminders.cron.ts)
  { key: 'tc.booking_window_days', group: 'teleconsultation', label: 'Créneaux proposés sur', help: 'Nombre de jours à venir où les jeunes peuvent réserver.', type: 'int', unit: 'jours', min: 7, max: 90, fallback: () => 30, public: true },
  { key: 'tc.min_lead_hours', group: 'teleconsultation', label: 'Délai minimum avant un rendez-vous', help: 'Une heure n’est réservable qu’à partir de maintenant + ce délai.', type: 'int', unit: 'heures', min: 0, max: 48, fallback: () => 5 },
  { key: 'tc.default_slot_minutes', group: 'teleconsultation', label: 'Durée d’un créneau (par défaut)', help: 'Utilisée pour un médecin sans durée propre.', type: 'int', unit: 'minutes', min: 15, max: 120, fallback: () => 30 },
  { key: 'tc.max_upcoming_per_patient', group: 'teleconsultation', label: 'Rendez-vous à venir par jeune', help: 'Évite les réservations en série.', type: 'int', min: 1, max: 10, fallback: () => 2 },
  { key: 'tc.reminder_minutes', group: 'teleconsultation', label: 'Rappel avant le début', help: 'E-mail ou SMS envoyé quand le rendez-vous commence dans moins de ce délai.', type: 'int', unit: 'minutes', min: 5, max: 60, fallback: () => 10, public: true },
  { key: 'tc.reminders_enabled', group: 'teleconsultation', label: 'Rappels envoyés', help: 'Coupés quoi qu’il arrive si TC_REMINDERS=off sur le serveur.', type: 'bool', fallback: () => true },
  { key: 'tc.referral_ttl_days', group: 'teleconsultation', label: 'Validité du code QR d’orientation', help: 'S’applique aux nouveaux codes.', type: 'int', unit: 'jours', min: 7, max: 365, fallback: () => 90 },
  // Campagnes (campaign-otp-email.ts, campaign-guard.ts)
  { key: 'campaign.otp_ttl_hours', group: 'campaigns', label: 'Validité du code de retrait d’un kit', help: 'S’applique aux nouveaux codes ; annoncée dans l’e-mail.', type: 'int', unit: 'heures', min: 1, max: 168, fallback: () => 48 },
  { key: 'campaign.guard_ip', group: 'campaigns', label: 'Anti-doublon par adresse IP', help: 'Une seule demande de kit par connexion internet.', type: 'bool', fallback: () => !envOff('CAMPAIGN_GUARD_IP') },
  { key: 'campaign.guard_fingerprint', group: 'campaigns', label: 'Anti-doublon par appareil', help: 'Une seule demande de kit par navigateur.', type: 'bool', fallback: () => !envOff('CAMPAIGN_GUARD_FINGERPRINT') },
  // Commandes (pickup-otp-email.ts, delivery-rules.ts)
  { key: 'order.pickup_otp_ttl_hours', group: 'orders', label: 'Validité du code de retrait d’une commande', help: 'S’applique aux nouveaux codes ; annoncée dans l’e-mail.', type: 'int', unit: 'heures', min: 1, max: 168, fallback: () => 48 },
  { key: 'delivery.max_failed_attempts', group: 'orders', label: 'Essais ratés avant blocage du lien de livraison', help: 'Livraison personnalisée : lien bloqué après ce nombre d’échecs.', type: 'int', min: 1, max: 20, fallback: () => 5 },
  // Contraception (contraception-rules.ts)
  { key: 'contraception.max_open_requests', group: 'contraception', label: 'Demandes en cours par jeune', help: 'Nouvelle demande refusée au-delà.', type: 'int', min: 1, max: 10, fallback: () => 3 },
  // Inscription (common/field-rules.ts, auth/seller-signup.ts)
  { key: 'signup.min_age', group: 'signup', label: 'Âge minimum', help: 'Inscription et ciblage des campagnes.', type: 'int', unit: 'ans', min: 10, max: 18, fallback: () => 10, public: true },
  { key: 'signup.max_age', group: 'signup', label: 'Âge maximum', help: 'Au-delà, la date de naissance est refusée.', type: 'int', unit: 'ans', min: 25, max: 100, fallback: () => 100, public: true },
  { key: 'signup.seller_open', group: 'signup', label: 'Inscription des vendeurs ouverte', help: 'Fermée depuis le 25/09/2026.', type: 'bool', fallback: () => process.env.SELLER_SIGNUP_OPEN === 'true' },
  // Sponsors (sponsor-rules.ts)
  { key: 'sponsor.invitation_ttl_days', group: 'sponsors', label: 'Validité du lien d’invitation', help: 'Annoncée dans l’e-mail ; s’applique aux nouveaux liens.', type: 'int', unit: 'jours', min: 1, max: 30, fallback: () => 7 },
  // Assistant IA (ai-chat.constants.ts, ai-chat-retention.cron.ts)
  { key: 'ai.rate_limit_max', group: 'ai', label: 'Questions par personne en 10 minutes', help: 'Au-delà, l’assistant demande d’attendre.', type: 'int', min: 5, max: 100, fallback: () => Number(process.env.AI_CHAT_RATE_LIMIT_MAX) || 20 },
  { key: 'ai.log_retention_days', group: 'ai', label: 'Conservation des échanges', help: 'Au plus 90 jours (durée annoncée à l’APDP) ; la politique de confidentialité affiche cette valeur.', type: 'int', unit: 'jours', min: 7, max: 90, fallback: () => 90, public: true },
  // Fichiers (profile-photo.controller.ts, uploads.controller.ts)
  { key: 'files.photo_max_mb', group: 'files', label: 'Photo de profil : taille maximale', help: 'JPEG, PNG ou WebP.', type: 'int', unit: 'Mo', min: 1, max: 10, fallback: () => 3, public: true },
  { key: 'files.attachment_max_mb', group: 'files', label: 'Fichiers de l’admin : taille maximale', help: 'Images et PDF envoyés depuis l’admin.', type: 'int', unit: 'Mo', min: 1, max: 10, fallback: () => 5 },
  { key: 'files.attachment_max_files', group: 'files', label: 'Fichiers de l’admin : nombre par envoi', help: '', type: 'int', min: 1, max: 20, fallback: () => 10 },
];

/** Plafonds techniques (limites fixées au démarrage du serveur) : la valeur réglée est contrôlée ensuite */
export const FILE_CEILING_BYTES = 10 * 1024 * 1024;
export const FILES_CEILING = 20;

const DEFS = new Map(SETTING_DEFS.map((d) => [d.key, d]));
const values = new Map<string, number | boolean>();

export function settingDef(key: string): SettingDef {
  const d = DEFS.get(key);
  if (!d) throw new BadRequestException('Paramètre inconnu.');
  return d;
}

/** Valeur en vigueur : enregistrée par le super admin, sinon valeur d'origine */
export function setting(key: string): number {
  const v = values.has(key) ? values.get(key) : settingDef(key).fallback();
  return Number(v);
}
export function settingOn(key: string): boolean {
  const v = values.has(key) ? values.get(key) : settingDef(key).fallback();
  return v === true;
}

/** Contrôle d'une valeur envoyée par l'admin (ou lue en base) */
export function parseSettingValue(def: SettingDef, raw: unknown): number | boolean {
  if (def.type === 'bool') {
    if (raw === true || raw === 'true' || raw === 1 || raw === '1') return true;
    if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false;
    throw new BadRequestException(`${def.label} : choisissez oui ou non.`);
  }
  const s = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d{1,6}$/.test(s)) throw new BadRequestException(`${def.label} : nombre entier attendu.`);
  const n = Number(s);
  if ((def.min != null && n < def.min) || (def.max != null && n > def.max)) {
    throw new BadRequestException(`${def.label} : entre ${def.min} et ${def.max}${def.unit ? ` ${def.unit}` : ''}.`);
  }
  return n;
}

/** Remplace le cache par les lignes lues en base ; une ligne invalide ou inconnue est ignorée (valeur d'origine) */
export function loadSettings(rows: { setting_key: string; value: string }[]) {
  const next = new Map<string, number | boolean>();
  for (const r of rows || []) {
    const d = DEFS.get(r.setting_key);
    if (!d) continue;
    try {
      next.set(d.key, parseSettingValue(d, r.value));
    } catch {
      /* valeur hors bornes : valeur d'origine */
    }
  }
  values.clear();
  next.forEach((v, k) => values.set(k, v));
}

export function isCustomized(key: string) {
  return values.has(key);
}

import { BadRequestException } from '@nestjs/common';
import { safeError } from '../common/request-log';

/**
 * Consentement à la collecte et au transfert des données (autorisation APDP n° 2026-327/AT/APDP/DST/SC
 * du 25 juin 2026, point b ; 30/10/2026). Migration 023.
 * À l'inscription (jeune, point de retrait, sponsor), la personne lit le document de consentement
 * (site : lib/consent.js) et coche la case ; l'API refuse l'inscription sans « consent: true »
 * puis enregistre la preuve : compte, document, version, date et adresse IP.
 * Changer le texte du document : changer CONSENT_VERSION ici ET sur le site (lib/consent.js).
 */
export const CONSENT_DOCUMENT = 'collecte_transfert';
export const CONSENT_VERSION = '2026-10-30';

export const CONSENT_REQUIRED_MESSAGE =
  'Pour créer un compte, vous devez lire et accepter le document de consentement à la collecte et au transfert de vos données.';

export function requireConsent(body: any): void {
  if (body?.consent !== true) throw new BadRequestException(CONSENT_REQUIRED_MESSAGE);
}

let missingTableLogged = false;

/** Preuve du consentement ; un échec d'écriture n'annule pas l'inscription (journalisé) */
export async function recordConsent(
  db: { query: (sql: string, params?: any[]) => Promise<any> },
  userId: number,
  ip: string | null,
): Promise<void> {
  if (!userId) return;
  try {
    await db.query(
      `INSERT INTO user_consents (user_id, document, version, ip, accepted_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP())`,
      [userId, CONSENT_DOCUMENT, CONSENT_VERSION, ip ? String(ip).slice(0, 64) : null],
    );
  } catch (err) {
    if (!missingTableLogged) console.error(`[consentement] preuve non enregistrée (compte ${userId}) :`, safeError(err));
    missingTableLogged = true;
  }
}

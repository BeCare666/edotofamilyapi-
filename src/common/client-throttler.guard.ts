import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { realClientIp } from './client-ip';

/**
 * Limitation de débit globale (audit sécurité 1.2, H2) : compte par adresse réelle du client
 * (CF-Connecting-IP), et non par req.ip qui, derrière Cloudflare et Render, serait l'adresse d'un proxy
 * partagée par tous les visiteurs.
 */
@Injectable()
export class ClientThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return realClientIp(req) || 'unknown';
  }
}

// Limites de l'audit : 100 requêtes par minute et par IP partout, 5 par heure sur les comptes et mots de passe
export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const THROTTLE_SENSITIVE = { default: { limit: 5, ttl: HOUR } };
export const THROTTLE_LOGIN = { default: { limit: 5, ttl: MINUTE } };

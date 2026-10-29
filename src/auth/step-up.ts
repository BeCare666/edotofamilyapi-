import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { DatabaseService } from '../database/database.services';
import { totpRequiredRoles } from './totp';

/**
 * Nouvelle demande du code de double authentification pour les actions sensibles
 * (audit sécurité 3.1, 29/10/2026) : suppressions, exports, approbation d'un export sponsor.
 * Le code saisi (POST /me/totp/step-up) donne une autorisation de 5 min, envoyée dans l'en-tête X-Step-Up.
 * Compte sans double authentification activée (et rôle hors TOTP_ROLES) : rien n'est demandé.
 */
export const SENSITIVE_KEY = 'sensitive-action';
export const SensitiveAction = () => SetMetadata(SENSITIVE_KEY, true);

export const STEP_UP_PURPOSE = 'totp-step-up';
export const STEP_UP_HEADER = 'x-step-up';
export const STEP_UP_SECONDS = 5 * 60;
export const STEP_UP_REQUIRED = 'STEP_UP_REQUIRED';

function stepUpKey(): string {
  return `${process.env.JWT_SECRET_KEY}:${STEP_UP_PURPOSE}`;
}

export function signStepUp(user: { id: number; token_version?: number }): { step_up: string; expires_at: string } {
  const step_up = jwt.sign({ id: user.id, purpose: STEP_UP_PURPOSE, tv: Number(user.token_version) || 0 }, stepUpKey(), {
    expiresIn: STEP_UP_SECONDS,
  });
  return { step_up, expires_at: new Date(Date.now() + STEP_UP_SECONDS * 1000).toISOString() };
}

/** Autorisation valide pour ce compte et cette version de session */
export function readStepUp(token: unknown, userId: number, tv: number): boolean {
  try {
    const p: any = jwt.verify(String(token || ''), stepUpKey());
    return p?.purpose === STEP_UP_PURPOSE && Number(p.id) === userId && Number(p.tv) === tv;
  } catch {
    return false;
  }
}

@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly db: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.reflector.get<boolean>(SENSITIVE_KEY, context.getHandler())) return true;
    const req = context.switchToHttp().getRequest();
    const userId = Number(req.user?.id);
    if (!userId) return true; // pas de session : le guard JWT a déjà répondu
    const [[u]]: any = await this.db.query('SELECT role, token_version, totp_enabled_at FROM users WHERE id = ? LIMIT 1', [userId]);
    const enabled = !!u?.totp_enabled_at;
    if (!enabled && !totpRequiredRoles().includes(u?.role)) return true;
    if (readStepUp(req.headers?.[STEP_UP_HEADER], userId, Number(u?.token_version) || 0)) return true;
    throw new ForbiddenException({
      statusCode: 403,
      error: STEP_UP_REQUIRED,
      message: 'Action sensible : confirmez avec le code de votre application d’authentification.',
    });
  }
}

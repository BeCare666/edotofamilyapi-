import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { DatabaseService } from '../database/database.services';
import { SENSITIVE_KEY } from '../auth/step-up';
import { maskUrl, safeError } from './request-log';
import { realClientIp } from './client-ip';

/**
 * Journal d'audit de l'admin (audit sécurité 3.3, 29/10/2026), table admin_audit_log (migration 020).
 * Qui (compte, rôle), quoi (méthode, adresse masquée, ressource), résultat (statut), quand, depuis quelle IP.
 * Comptes concernés : super admin, boutique, équipe. Actions : POST, PUT, PATCH, DELETE, et les exports
 * (routes @SensitiveAction en lecture). Jamais le contenu de la requête ni de la réponse.
 * Un échec d'écriture ne bloque pas l'action : il est signalé dans les journaux.
 */
export const AUDITED_ROLES = ['super_admin', 'store_owner', 'staff'];
const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
// Connexion et session : déjà tracées ailleurs ou trop fréquentes (renouvellement toutes les minutes)
const SKIPPED = [/^\/(api\/)?token(\/|$)/, /^\/(api\/)?me\/totp(\/|$)/, /^\/(api\/)?logout$/];

export function auditEntry(req: any, status: number, sensitive: boolean) {
  const role = Array.isArray(req?.user?.permissions) ? String(req.user.permissions[0] || '') : '';
  const method = String(req?.method || '').toUpperCase();
  const path = String(req?.originalUrl || req?.url || '').split('?')[0];
  if (!req?.user?.id || !AUDITED_ROLES.includes(role)) return null;
  if (!WRITE_METHODS.includes(method) && !sensitive) return null;
  if (SKIPPED.some((re) => re.test(path))) return null;
  // Ressource : premier segment utile de l'adresse ; identifiant : paramètre :id s'il existe
  const parts = path.replace(/^\/api\//, '/').split('/').filter(Boolean);
  const resource = (parts[0] === 'admin' ? parts[1] : parts[0]) || null;
  const id = req?.params?.id ?? null;
  return {
    actor_user_id: Number(req.user.id),
    actor_role: role,
    method,
    route: maskUrl(path).slice(0, 300),
    resource: resource ? resource.slice(0, 60) : null,
    resource_id: id != null ? String(id).slice(0, 64) : null,
    status,
    ip: realClientIp(req),
  };
}

@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector, private readonly db: DatabaseService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();
    const sensitive = this.reflector.get<boolean>(SENSITIVE_KEY, context.getHandler()) === true;
    // Statut connu à la fin de la réponse (réussite ou erreur)
    res.on?.('finish', () => {
      const e = auditEntry(req, Number(res.statusCode), sensitive);
      if (!e) return;
      this.db
        .query(
          `INSERT INTO admin_audit_log (actor_user_id, actor_role, method, route, resource, resource_id, status, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [e.actor_user_id, e.actor_role, e.method, e.route, e.resource, e.resource_id, e.status, e.ip],
        )
        .catch((err: unknown) => console.error('[audit] journal non écrit :', safeError(err)));
    });
    return next.handle();
  }
}

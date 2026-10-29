import { EventEmitter } from 'events';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { AdminAuditInterceptor, auditEntry } from './admin-audit';

// Audit sécurité 3.3 (29/10/2026) : journal des actions faites depuis l'admin
describe('Journal d’audit de l’admin', () => {
  const admin = { id: 1, permissions: ['super_admin'] };
  const req = (over: any) => ({ method: 'DELETE', originalUrl: '/api/products/42', params: { id: '42' }, user: admin, headers: {}, ip: '203.0.113.5', ...over });

  it('suppression par le super admin : qui, quoi, résultat, IP', () => {
    expect(auditEntry(req({}), 200, false)).toEqual({
      actor_user_id: 1, actor_role: 'super_admin', method: 'DELETE', route: '/api/products/42',
      resource: 'products', resource_id: '42', status: 200, ip: '203.0.113.5',
    });
  });

  it('routes /admin/... : ressource = segment suivant ; adresse masquée (jetons)', () => {
    const e = auditEntry(req({ method: 'POST', originalUrl: '/api/admin/sponsor-exports/9/approve?token=abc', params: { id: '9' } }), 201, false)!;
    expect(e.resource).toBe('sponsor-exports');
    expect(e.route).toBe('/api/admin/sponsor-exports/9/approve');
    expect(auditEntry(req({ method: 'POST', originalUrl: '/api/courier-links/secret/open' }), 200, false)!.route).toBe('/api/courier-links/***/open');
  });

  it('export (lecture marquée sensible) : journalisé ; lecture ordinaire : non', () => {
    expect(auditEntry(req({ method: 'GET', originalUrl: '/api/admin/campaigns/export' }), 200, true)?.method).toBe('GET');
    expect(auditEntry(req({ method: 'GET', originalUrl: '/api/products' }), 200, false)).toBeNull();
  });

  it('jeune, médecin, sans session, connexion et renouvellement : non journalisés', () => {
    expect(auditEntry(req({ user: { id: 5, permissions: ['customer'] } }), 200, false)).toBeNull();
    expect(auditEntry(req({ user: { id: 5, permissions: ['doctor'] } }), 200, false)).toBeNull();
    expect(auditEntry(req({ user: undefined }), 401, false)).toBeNull();
    expect(auditEntry(req({ method: 'POST', originalUrl: '/api/token/refresh' }), 201, false)).toBeNull();
    expect(auditEntry(req({ method: 'POST', originalUrl: '/api/me/totp/step-up' }), 201, false)).toBeNull();
  });

  it('écrit la ligne à la fin de la réponse, avec le statut final ; jamais le corps', async () => {
    const query = jest.fn(async () => [{}]);
    const res: any = new EventEmitter();
    res.statusCode = 403;
    const r = req({ body: { password: 'secret' } });
    const ctx: any = { getType: () => 'http', getHandler: () => () => undefined, switchToHttp: () => ({ getRequest: () => r, getResponse: () => res }) };
    await new AdminAuditInterceptor(new Reflector(), { query } as any).intercept(ctx, { handle: () => of(null) }).toPromise();
    res.emit('finish');
    expect(query).toHaveBeenCalledTimes(1);
    const params = (query.mock.calls[0] as any)[1];
    expect(params[6]).toBe(403);
    expect(JSON.stringify(params)).not.toContain('secret');
  });
});

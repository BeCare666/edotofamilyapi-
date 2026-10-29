import { readFileSync } from 'fs';
import { join } from 'path';
import { maskEmail, maskPhone, maskUrl, requestLogger, safeError } from './request-log';

// Audit sécurité 2.7 (29/10/2026) : journaux sans jeton, sans corps, sans données personnelles complètes
describe('Journal des requêtes : adresses masquées', () => {
  it.each([
    ['/api/courier-links/abc123def/open', '/api/courier-links/***/open'],
    ['/api/sponsor-invitations/9f8e7d', '/api/sponsor-invitations/***'],
    ['/api/sponsor-invitations/accept', '/api/sponsor-invitations/accept'],
    ['/api/teleconsultation/invitations/tok42', '/api/teleconsultation/invitations/***'],
    ['/api/teleconsultation/invitations/accept', '/api/teleconsultation/invitations/accept'],
    ['/api/teleconsultation/qr/abcdef.png', '/api/teleconsultation/qr/***'],
    ['/api/teleconsultation/qr-info/abcdef', '/api/teleconsultation/qr-info/***'],
    ['/api/teleconsultation/center/dossier/token/a1b2', '/api/teleconsultation/center/dossier/token/***'],
    ['/api/teleconsultation/center/dossier/code/ABCD2345', '/api/teleconsultation/center/dossier/code/***'],
    ['/api/verify-email?token=eyJhbGci.x.y&lang=fr', '/api/verify-email?token=***&lang=fr'],
    ['/api/products?search=pilule&page=2', '/api/products?search=pilule&page=2'],
    ['/api/x?Email=a%40b.com&otp=123456&code=9', '/api/x?Email=***&otp=***&code=***'],
  ])('%s → %s', (url, masked) => {
    expect(maskUrl(url)).toBe(masked);
  });

  it('une ligne par requête terminée : méthode, adresse masquée, statut, durée ; aucun en-tête', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const handlers: Record<string, () => void> = {};
    const res: any = { statusCode: 401, on: (ev: string, fn: () => void) => (handlers[ev] = fn) };
    const next = jest.fn();
    requestLogger()({ method: 'GET', originalUrl: '/api/courier-links/secret', headers: { authorization: 'Bearer abc' } }, res, next);
    expect(next).toHaveBeenCalled();
    handlers.finish();
    const line = String(log.mock.calls[0][0]);
    expect(line).toMatch(/^GET \/api\/courier-links\/\*\*\* 401 \d+ms$/);
    expect(line).not.toContain('Bearer');
    log.mockRestore();
  });
});

describe('Erreurs et données personnelles dans les journaux', () => {
  it('safeError : code et message seulement, sans la requête SQL ni l’e-mail', () => {
    const err: any = new Error("Duplicate entry 'jeune@gmail.com' for key 'users.email'");
    err.code = 'ER_DUP_ENTRY';
    err.sql = "INSERT INTO users (email, password) VALUES ('jeune@gmail.com', '$2b$10$hash')";
    const out = safeError(err);
    expect(out).toBe("ER_DUP_ENTRY Duplicate entry '***@***' for key 'users.email'");
    expect(out).not.toContain('$2b$');
    expect(safeError({ response: { status: 401 }, message: 'unauthorized' })).toBe('(HTTP 401) unauthorized');
  });

  it('e-mail et téléphone masqués', () => {
    expect(maskEmail('jeune@gmail.com')).toBe('j***@gmail.com');
    expect(maskEmail(null)).toBe('***');
    expect(maskPhone('+229 01 97 00 00 42')).toBe('***42');
    expect(maskPhone('')).toBe('***');
  });

  it('plus de journal des en-têtes, de req.user ni des DTO (M3)', () => {
    const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
    expect(read('main.ts')).not.toMatch(/console\.log\(`📥/);
    expect(read('analytics/analytics.controller.ts')).not.toMatch(/console\.log\([^)]*req\.user/);
    expect(read('shops/shops.controller.ts')).not.toMatch(/console\.log\([^)]*req\.user/);
    expect(read('products/products.service.ts')).not.toMatch(/console\.log\([^)]*createProductDto\)/);
    expect(read('ai/chat/ai-chat.service.ts')).not.toMatch(/texte : \$\{answer/);
  });
});

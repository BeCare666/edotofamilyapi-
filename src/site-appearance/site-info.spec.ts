import { BadRequestException } from '@nestjs/common';
import { SITE_INFO_DEFAULTS, SiteInfoService, parseSiteInfo } from './site-info';

// Informations du site (B5, 30/10/2026)
const ok = { phone: '+229 01 67 69 81 91', email: 'Contact@Edotofamily.com ', address: 'St Rita, Cotonou, Bénin' };

describe('Informations du site : règles', () => {
  it('contact nettoyé ; réseaux et carte vides = masqués', () => {
    expect(parseSiteInfo(ok)).toEqual({
      phone: '+229 01 67 69 81 91', email: 'contact@edotofamily.com', address: 'St Rita, Cotonou, Bénin', map_url: null,
      instagram: null, facebook: null, tiktok: null, linkedin: null, x_url: null, youtube: null,
    });
  });

  it('téléphone, e-mail, adresse invalides : refusés', () => {
    expect(() => parseSiteInfo({ ...ok, phone: '67-69' })).toThrow(BadRequestException);
    expect(() => parseSiteInfo({ ...ok, email: 'contact' })).toThrow(BadRequestException);
    expect(() => parseSiteInfo({ ...ok, address: ' ' })).toThrow(BadRequestException);
  });

  it('réseaux : https et le bon site seulement', () => {
    const v = parseSiteInfo({ ...ok, instagram: 'https://www.instagram.com/edotofamily', x_url: 'https://twitter.com/edoto' });
    expect(v.instagram).toBe('https://www.instagram.com/edotofamily');
    expect(v.x_url).toBe('https://twitter.com/edoto');
    expect(() => parseSiteInfo({ ...ok, facebook: 'http://facebook.com/edoto' })).toThrow(BadRequestException);
    expect(() => parseSiteInfo({ ...ok, facebook: 'https://facebook.com.evil.io/edoto' })).toThrow(BadRequestException);
    expect(() => parseSiteInfo({ ...ok, tiktok: 'javascript:alert(1)' })).toThrow(BadRequestException);
  });

  it('carte : seulement un lien d’intégration Google Maps', () => {
    expect(parseSiteInfo({ ...ok, map_url: 'https://www.google.com/maps/embed?pb=!1m18' }).map_url).toBe('https://www.google.com/maps/embed?pb=!1m18');
    expect(() => parseSiteInfo({ ...ok, map_url: 'https://evil.io/maps/embed?x' })).toThrow(BadRequestException);
    expect(() => parseSiteInfo({ ...ok, map_url: 'https://www.google.com/maps/place/Cotonou' })).toThrow(BadRequestException);
  });
});

describe('Informations du site : lecture et enregistrement', () => {
  it('table absente (avant la migration 026) : valeurs de départ', async () => {
    const svc = new SiteInfoService({ getPool: () => ({ query: async () => { throw new Error("Table 'site_info' doesn't exist"); } }) } as any);
    expect(await svc.get()).toEqual({ ...SITE_INFO_DEFAULTS, updated_at: null });
  });

  it('enregistrement : une seule ligne (id 1), toutes les colonnes, admin noté', async () => {
    const calls: any[] = [];
    const query = jest.fn(async (sql: string, params: any[] = []) => {
      calls.push({ sql, params });
      return sql.startsWith('SELECT') ? [[{ ...SITE_INFO_DEFAULTS, instagram: 'https://www.instagram.com/edotofamily' }]] : [{ affectedRows: 1 }];
    });
    const res = await new SiteInfoService({ getPool: () => ({ query }) } as any).update({ ...ok, instagram: 'https://www.instagram.com/edotofamily' }, 1);
    expect(res.success).toBe(true);
    expect(calls[0].sql).toContain('INSERT INTO site_info (id, phone, email, address, map_url, instagram');
    expect(calls[0].sql).toContain('ON DUPLICATE KEY UPDATE');
    expect(calls[0].params.slice(0, 5)).toEqual(['+229 01 67 69 81 91', 'contact@edotofamily.com', 'St Rita, Cotonou, Bénin', null, 'https://www.instagram.com/edotofamily']);
    expect(calls[0].params[calls[0].params.length - 1]).toBe(1);
  });
});

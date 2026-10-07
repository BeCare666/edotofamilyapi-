import { BadRequestException } from '@nestjs/common';
import { SITE_FONT_KEYS, SiteAppearanceService } from './site-appearance.service';

function fakeDb(handler: (sql: string, params: any[]) => any) {
  const calls: { sql: string; params: any[] }[] = [];
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    const out = handler(sql, params);
    if (out instanceof Error) throw out;
    return [out ?? [], []];
  });
  return { calls, db: { getPool: () => ({ query }) } as any };
}

describe('Police du site (super admin)', () => {
  it('12 polices proposées, Poppins comprise', () => {
    expect(SITE_FONT_KEYS).toHaveLength(12);
    expect(SITE_FONT_KEYS).toContain('poppins');
    expect(SITE_FONT_KEYS).toContain('cormorant-garamond');
  });

  it('lecture : valeur enregistrée ; valeur inconnue, ligne absente ou table absente → Poppins', async () => {
    expect((await new SiteAppearanceService(fakeDb(() => [{ font_key: 'manrope', updated_at: 'x' }]).db).get()).font).toBe('manrope');
    expect((await new SiteAppearanceService(fakeDb(() => [{ font_key: 'comic-sans' }]).db).get()).font).toBe('poppins');
    expect((await new SiteAppearanceService(fakeDb(() => []).db).get()).font).toBe('poppins');
    expect((await new SiteAppearanceService(fakeDb(() => new Error("Table 'site_appearance' doesn't exist")).db).get()).font).toBe('poppins');
  });

  it('modification : uniquement une police de la liste ; enregistre la police et l’admin', async () => {
    const svc = (h: any) => new SiteAppearanceService(fakeDb(h).db);
    await expect(svc(() => []).setFont('comic-sans', 1)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc(() => []).setFont("'; DROP TABLE users; --", 1)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc(() => []).setFont(undefined, 1)).rejects.toBeInstanceOf(BadRequestException);
    const f = fakeDb((sql) => (sql.startsWith('SELECT') ? [{ font_key: 'inter' }] : { affectedRows: 1 }));
    const res = await new SiteAppearanceService(f.db).setFont('inter', 7);
    expect(f.calls[0].sql).toContain('INSERT INTO site_appearance');
    expect(f.calls[0].params).toEqual(['inter', 7]);
    expect(res.font).toBe('inter');
  });
});

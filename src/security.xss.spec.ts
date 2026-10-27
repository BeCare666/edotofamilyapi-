/**
 * Audit sécurité 1.6 (26/10/2026, H1) : le HTML enregistré (produits, boutiques ; FAQ et CGV retirées en N5)
 * est nettoyé avant d'entrer en base. Le contenu réel (h2, h3, p, strong, listes) reste identique.
 */
import { safeHtml } from './common/safe-html';
import { ProductsService } from './products/products.service';
import { ShopsService } from './shops/shops.service';

const EVIL =
  '<p onclick="alert(1)">Bonjour</p><script>alert(document.cookie)</script><img src=x onerror=alert(1)>' +
  '<a href="javascript:alert(1)">lien</a><svg onload=alert(1)></svg><iframe src="https://evil.example"></iframe>';
const EVIL_CLEAN = '<p>Bonjour</p><a>lien</a>';

function fakeDb() {
  const calls: { sql: string; params: any[] }[] = [];
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    if (sql.trim().startsWith('SELECT')) return [[], []];
    return [{ insertId: 1, affectedRows: 1 }, []];
  });
  const connection = { query, beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn() };
  return { calls, db: { query, getPool: () => ({ query, getConnection: async () => connection }) } as any };
}

const writes = (calls: { sql: string; params: any[] }[]) => calls.filter((c) => /^\s*(INSERT|UPDATE)/.test(c.sql));

describe('safeHtml', () => {
  it('retire scripts, événements, images, iframes et liens javascript:, garde le texte', () => {
    expect(safeHtml(EVIL)).toBe(EVIL_CLEAN);
  });

  it('garde un lien https, retire http, mailto et les liens relatifs au protocole', () => {
    expect(safeHtml('<a href="https://www.edotofamily.com" target="_blank" style="color:red">ok</a>')).toBe(
      '<a href="https://www.edotofamily.com">ok</a>',
    );
    expect(safeHtml('<a href="http://x.example">a</a><a href="mailto:x@y.z">b</a><a href="//evil.example">c</a>')).toBe(
      '<a>a</a><a>b</a><a>c</a>',
    );
  });

  it('description réelle de production inchangée', () => {
    const real =
      '<h2>🧪 Test de Grossesse – Fiable et rapide</h2><p>Le <strong>test de grossesse</strong> permet de savoir.</p>' +
      '<h3>Avantages</h3><ul><li>Rapide</li><li>Fiable</li></ul>';
    expect(safeHtml(real)).toBe(real);
  });

  it('b et i deviennent strong et em ; style et class retirés', () => {
    expect(safeHtml('<p class="ql-align-center" style="color:red"><b>a</b> <i>b</i></p>')).toBe(
      '<p><strong>a</strong> <em>b</em></p>',
    );
  });

  // Contournements corrigés entre sanitize-html 2.13.1 et 2.18.0 (audit 2.1, 26/10/2026)
  it('contournements connus (noscript, textarea, meta refresh, SVG) neutralisés', () => {
    const payloads = [
      '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></p></noscript>',
      '<textarea></textarea/><img src=x onerror=alert(1)></textarea>',
      '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
      '<svg><animate attributeName="href" values="javascript:alert(1)"/><a><text>x</text></a></svg>',
      '<form action="javascript:alert(1)"><button formaction="javascript:alert(1)">x</button></form>',
    ];
    for (const p of payloads) {
      const out = safeHtml(p) as string;
      expect(out).not.toMatch(/<(img|script|meta|svg|animate|form|button|noscript|textarea)\b/i);
      expect(out).not.toMatch(/onerror|javascript:/i);
    }
  });

  it('null et undefined passent tels quels (champ non modifié)', () => {
    expect(safeHtml(null)).toBeNull();
    expect(safeHtml(undefined)).toBeUndefined();
  });
});

describe('nettoyage à l’enregistrement', () => {
  it('produit : modification', async () => {
    const { db, calls } = fakeDb();
    const s = new ProductsService(db);
    jest.spyOn(s, 'getProductById').mockResolvedValue({} as any);
    await s.update(1, { description: EVIL, name: 'Kit' } as any);
    const [u] = writes(calls);
    expect(u.params).toContain(EVIL_CLEAN);
    expect(u.params).toContain('Kit');
  });

  it('boutique : modification', async () => {
    const { db, calls } = fakeDb();
    const s = new ShopsService(db);
    jest.spyOn(s as any, 'getShopById').mockResolvedValue({} as any);
    await s.update(1, { description: EVIL, name: 'Boutique' } as any);
    const [u] = writes(calls);
    expect(u.params).toContain(EVIL_CLEAN);
    expect(u.params).toContain('Boutique');
  });
});

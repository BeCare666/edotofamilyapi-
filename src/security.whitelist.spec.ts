/**
 * Phase 0.4 de l'audit sécurité (22/10/2026, C1) : les update() dynamiques n'acceptent
 * plus que des colonnes connues. Une clé piégée ne doit jamais entrer dans le SQL.
 */
import { TaxesService } from './taxes/taxes.service';
import { TagsService } from './tags/tags.service';
import { QuestionService } from './questions/questions.service';

const EVIL = "name = (SELECT password FROM users LIMIT 1), slug";
const EVIL2 = 'id = 1; DROP TABLE users; --';

function fakeDb() {
  const calls: { sql: string; params: any[] }[] = [];
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT')) return [[{ id: 1 }], []];
    return [{ affectedRows: 1 }, []];
  });
  return { calls, db: { query, getPool: () => ({ query }) } as any };
}

const updates = (calls: { sql: string; params: any[] }[]) => calls.filter((c) => c.sql.startsWith('UPDATE'));

describe('listes blanches des update()', () => {
  it('taxes : clé piégée ignorée', async () => {
    const { db, calls } = fakeDb();
    await new TaxesService(db).update(1, { [EVIL2]: 'x', rate: 18 } as any);
    const [u] = updates(calls);
    expect(u.sql).toBe('UPDATE taxes SET rate = ?, updated_at = ? WHERE id = ?');
    expect(u.sql).not.toContain('DROP');
  });

  it('tags : clé piégée ignorée', async () => {
    const { db, calls } = fakeDb();
    await new TagsService(db).update(1, { [EVIL]: 'x', name: 'Santé' } as any);
    const [u] = updates(calls);
    expect(u.sql).toBe('UPDATE tags SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    expect(u.params).toEqual(['Santé', 1]);
  });

  it('questions : seules question et answer passent', async () => {
    const { db, calls } = fakeDb();
    await new QuestionService(db).update(1, { [EVIL2]: 'x', answer: 'Oui' } as any);
    const [u] = updates(calls);
    expect(u.sql).toBe('UPDATE questions SET answer = ?, updated_at = NOW() WHERE id = ?');
    expect(u.params).toEqual(['Oui', 1]);
  });

  it('questions : rien de connu, aucune requête UPDATE', async () => {
    const { db, calls } = fakeDb();
    await new QuestionService(db).update(1, { [EVIL]: 'x' } as any);
    expect(updates(calls)).toHaveLength(0);
  });
});

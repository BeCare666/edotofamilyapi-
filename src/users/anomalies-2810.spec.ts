import 'reflect-metadata';
import { UsersService } from './users.service';
import { QuestionController } from 'src/questions/questions.controller';
import { ShopsController } from 'src/shops/shops.controller';

// Anomalies relevées pendant l'audit 2.3, corrigées le 28/10/2026

describe('Bloquer / débloquer un compte (explicite)', () => {
  const make = (isActive: number) => {
    const query = jest.fn(async (sql: string) => {
      if (sql.startsWith('SELECT')) return [[{ id: 5, is_active: isActive }], []];
      return [{ affectedRows: 1 }, []];
    });
    const db: any = { getPool: () => ({ query }), query };
    return { service: new UsersService(db), query };
  };
  const writes = (query: jest.Mock) =>
    query.mock.calls.filter(([sql]) => sql.startsWith('UPDATE users SET is_active')).map(([, params]) => params);

  it('débloquer un compte déjà actif le laisse actif', async () => {
    const { service, query } = make(1);
    await service.activeUser(5);
    expect(writes(query)).toEqual([[1, 5]]);
  });

  it('bloquer un compte déjà bloqué le laisse bloqué', async () => {
    const { service, query } = make(0);
    await service.banUser(5);
    expect(writes(query)).toEqual([[0, 5]]);
  });

  it('chaque changement invalide les jetons émis avant (audit 1.5)', async () => {
    const { service, query } = make(1);
    await service.banUser(5);
    expect(query.mock.calls.some(([sql]) => sql.includes('token_version = token_version + 1'))).toBe(true);
  });
});

describe('Identifiant de l\'utilisateur connecté (jeton : id)', () => {
  it('POST /questions : user_id = id du jeton', async () => {
    const svc: any = { create: jest.fn().mockResolvedValue({}) };
    const ctrl = new QuestionController(svc);
    await ctrl.create({ question: 'Q ?' } as any, { user: { id: 7, permissions: ['customer'] } });
    expect(svc.create).toHaveBeenCalledWith({ question: 'Q ?', user_id: 7 });
  });

  it('POST /shops : owner_id = id du jeton', async () => {
    const svc: any = { create: jest.fn().mockResolvedValue({}) };
    const ctrl = new ShopsController(svc);
    await ctrl.create({ user: { id: 3, permissions: ['super_admin'] } }, { name: 'B' } as any);
    expect(svc.create).toHaveBeenCalledWith({ name: 'B', owner_id: 3 });
  });
});

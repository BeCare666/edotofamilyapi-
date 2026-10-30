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

describe('PUT et DELETE /order-status/:id : table order_status, jamais une commande', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { OrdersService } = require('src/orders/orders.service');
  const make = (affectedRows = 1) => {
    const query = jest.fn(async (sql: string) => (sql.startsWith('SELECT') ? [[{ id: 4, name: 'X' }], []] : [{ affectedRows }, []]));
    return { service: new OrdersService({} as any, { getPool: () => ({ query }) } as any), query };
  };

  it('modification : UPDATE order_status, colonnes réelles seulement', async () => {
    const { service, query } = make();
    await service.updateOrderStatus(4, { name: 'Livrée', color: '#00ff00', description: 'ignorée' });
    const sqls = query.mock.calls.map(([sql]) => sql);
    expect(sqls.some((s) => s.startsWith('UPDATE order_status SET name = ?, color = ?'))).toBe(true);
    expect(sqls.some((s) => /\borders\b/.test(s))).toBe(false);
  });

  it('suppression : DELETE order_status, jamais orders ni order_children', async () => {
    const { service, query } = make();
    await service.removeOrderStatus(4);
    const sqls = query.mock.calls.map(([sql]) => sql);
    expect(sqls).toEqual(['DELETE FROM order_status WHERE id = ?']);
  });

  it('statut inconnu → 404 ; aucun champ → 400', async () => {
    await expect(make(0).service.removeOrderStatus(99)).rejects.toThrow('Statut introuvable.');
    await expect(make().service.updateOrderStatus(4, {})).rejects.toThrow('Aucun champ modifiable fourni.');
  });
});

describe('Avatar du profil admin : adresse lue dans « original »', () => {
  it('avatar { id, original, thumbnail } enregistré dans avatars et lié au profil', async () => {
    const query = jest.fn(async (sql: string, _params?: any[]) => {
      if (sql.startsWith('SELECT id FROM users')) return [[{ id: 5 }], []];
      if (sql.startsWith('SELECT id FROM avatars')) return [[], []];
      if (sql.startsWith('INSERT INTO avatars')) return [{ insertId: 77 }, []];
      if (sql.startsWith('SELECT id FROM profiles')) return [[{ id: 1 }], []];
      if (sql.startsWith('SELECT')) return [[{ id: 5 }], []];
      return [{ affectedRows: 1 }, []];
    });
    const db: any = { getPool: () => ({ query }), query };
    const service = new UsersService(db);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    await service.update(5, { profile: { id: 1, avatar: { id: 3, original: 'https://res.cloudinary.com/x/a.jpg', thumbnail: 'https://res.cloudinary.com/x/a.jpg' } } } as any);
    const insert = query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO avatars'));
    expect(insert?.[1]).toEqual(['https://res.cloudinary.com/x/a.jpg', 'https://res.cloudinary.com/x/a.jpg']);
    const link = query.mock.calls.find(([sql]) => sql.includes('UPDATE profiles') && sql.includes('avatar_id'));
    expect(link?.[1]).toContain(77);
    (console.log as jest.Mock).mockRestore();
  });
});

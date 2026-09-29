import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { BecomeSellerController } from './become-seller.controller';
import { BecomeSellerService } from './become-seller.service';
import { UsersController } from '../users/users.controller';
import { ROLES_KEY, SUPER_ADMIN } from '../auth/roles.decorator';
import { SELLER_SIGNUP_CLOSED_MESSAGE } from '../auth/seller-signup';

function fakeDb(role: string | null) {
  const calls: { sql: string; params: any[] }[] = [];
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT role FROM users')) return [role ? [{ role }] : [], []];
    return [[{ id: 1, email: 'a@t.io' }], []];
  });
  return { calls, db: { query } as any };
}

describe('Inscription des vendeurs (fermée, décision du 25/09/2026)', () => {
  const OLD = process.env.SELLER_SIGNUP_OPEN;
  afterEach(() => {
    if (OLD === undefined) delete process.env.SELLER_SIGNUP_OPEN;
    else process.env.SELLER_SIGNUP_OPEN = OLD;
  });

  it('POST became-seller : refusé tant que l’inscription est fermée, aucun changement de rôle', async () => {
    delete process.env.SELLER_SIGNUP_OPEN;
    const { db, calls } = fakeDb('customer');
    const ctrl = new BecomeSellerController(new BecomeSellerService(db));
    await expect(ctrl.create({ user: { id: 5 } } as any)).rejects.toThrow(SELLER_SIGNUP_CLOSED_MESSAGE);
    await expect(ctrl.create({ user: { id: 5 } } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(calls).toHaveLength(0);
  });

  it('users/became-seller : refusé aussi', async () => {
    delete process.env.SELLER_SIGNUP_OPEN;
    const users = { updateUserRole: jest.fn() };
    const ctrl = new UsersController(users as any);
    await expect(ctrl.becomeSeller({ user: { userId: 5 } } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(users.updateUserRole).not.toHaveBeenCalled();
  });

  it('réouverture (SELLER_SIGNUP_OPEN=true) : seul un client devient vendeur ; un admin ou un point de retrait garde son rôle', async () => {
    process.env.SELLER_SIGNUP_OPEN = 'true';
    for (const role of ['super_admin', 'super_pickuppoint']) {
      const { db, calls } = fakeDb(role);
      await expect(new BecomeSellerController(new BecomeSellerService(db)).create({ user: { id: 5 } } as any))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(calls.some((c) => c.sql.startsWith('UPDATE users'))).toBe(false);
    }
    const { db, calls } = fakeDb('customer');
    await new BecomeSellerController(new BecomeSellerService(db)).create({ user: { id: 5 } } as any);
    const up = calls.find((c) => c.sql.startsWith('UPDATE users'));
    expect(up.sql).toContain('AND role = ?');
    expect(up.params).toEqual(['store_owner', 5, 'customer']);
  });

  it('GET became-seller : réservé à l’admin, sans mot de passe', async () => {
    expect(Reflect.getMetadata(ROLES_KEY, BecomeSellerController.prototype.findAll)).toEqual([SUPER_ADMIN]);
    const { db, calls } = fakeDb(null);
    await new BecomeSellerService(db).findAll();
    expect(calls[0].sql).not.toContain('*');
    expect(calls[0].sql).not.toContain('password');
  });
});

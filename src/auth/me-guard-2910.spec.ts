import { existsSync } from 'fs';
import { join } from 'path';
import { AuthController } from './auth.controller';

// Audit sécurité 2.9 (29/10/2026)
describe('GET /me et POST /add-points (M12) : utilisateur fourni par le guard JWT global', () => {
  const make = () => {
    const authService: any = { meById: jest.fn(async (id: number) => ({ id })), me: jest.fn() };
    return { authService, ctrl: new AuthController(authService as any) };
  };

  it('GET /me lit req.user.id, sans décoder le jeton une seconde fois', async () => {
    const { authService, ctrl } = make();
    await ctrl.me({ user: { id: 42 }, headers: { authorization: 'Bearer autre-jeton' } });
    expect(authService.meById).toHaveBeenCalledWith(42);
    expect(authService.me).not.toHaveBeenCalled();
  });

  it('POST /add-points : même chemin', async () => {
    const { authService, ctrl } = make();
    await ctrl.addWalletPoints({}, { user: { id: 7 } });
    expect(authService.meById).toHaveBeenCalledWith(7);
  });
});

describe('Messages qui révèlent l’existence d’un compte (M1)', () => {
  it('cacheauthservices.ts (inutilisé, « Mot de passe incorrect ») est supprimé', () => {
    expect(existsSync(join(__dirname, 'cacheauthservices.ts'))).toBe(false);
  });
});

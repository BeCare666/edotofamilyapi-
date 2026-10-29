import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { readStepUp, SENSITIVE_KEY, signStepUp, StepUpGuard, STEP_UP_REQUIRED } from './step-up';
import { ProductsController } from '../products/products.controller';
import { CampaignsAdminController } from '../campaigns/campaigns-admin.controller';
import { ProfilePhotoController } from '../users/profile-photo.controller';

// Audit sécurité 3.1 (29/10/2026) : code redemandé pour les actions sensibles
describe('Actions sensibles : code de double authentification redemandé', () => {
  const ENV = { ...process.env };
  beforeAll(() => {
    process.env.JWT_SECRET_KEY = 'cle-de-test';
  });
  afterEach(() => {
    delete process.env.TOTP_ROLES;
  });
  afterAll(() => {
    process.env = ENV;
  });

  const ctx = (sensitive: boolean, headers: any = {}, user: any = { id: 3 }) => {
    const handler = () => undefined;
    if (sensitive) Reflect.defineMetadata(SENSITIVE_KEY, true, handler);
    return { getHandler: () => handler, switchToHttp: () => ({ getRequest: () => ({ user, headers }) }) } as any;
  };
  const guard = (row: any) => new StepUpGuard(new Reflector(), { query: jest.fn(async () => [[row]]) } as any);
  const enabled = { role: 'super_admin', token_version: 2, totp_enabled_at: '2026-10-29' };

  it('route ordinaire : rien n’est demandé', async () => {
    await expect(guard(enabled).canActivate(ctx(false))).resolves.toBe(true);
  });

  it('double authentification activée, sans autorisation : 403 STEP_UP_REQUIRED', async () => {
    await expect(guard(enabled).canActivate(ctx(true))).rejects.toMatchObject({ response: { error: STEP_UP_REQUIRED } });
  });

  it('autorisation valide (même compte, même version de session) : action permise', async () => {
    const { step_up } = signStepUp({ id: 3, token_version: 2 });
    await expect(guard(enabled).canActivate(ctx(true, { 'x-step-up': step_up }))).resolves.toBe(true);
  });

  it('autorisation d’un autre compte, d’une ancienne session ou falsifiée : refusée', async () => {
    const other = signStepUp({ id: 4, token_version: 2 }).step_up;
    const old = signStepUp({ id: 3, token_version: 1 }).step_up;
    for (const t of [other, old, 'faux']) {
      await expect(guard(enabled).canActivate(ctx(true, { 'x-step-up': t }))).rejects.toMatchObject({ response: { error: STEP_UP_REQUIRED } });
    }
    expect(readStepUp(other, 3, 2)).toBe(false);
  });

  it('compte sans double authentification (rôle hors TOTP_ROLES) : rien n’est demandé ; rôle listé : demandé', async () => {
    const off = { role: 'super_admin', token_version: 0, totp_enabled_at: null };
    await expect(guard(off).canActivate(ctx(true))).resolves.toBe(true);
    process.env.TOTP_ROLES = 'all';
    await expect(guard(off).canActivate(ctx(true))).rejects.toMatchObject({ response: { error: STEP_UP_REQUIRED } });
  });

  it('routes marquées : suppression d’un produit, export des campagnes ; pas la photo de profil', () => {
    const marked = (proto: any, m: string) => Reflect.getMetadata(SENSITIVE_KEY, proto[m]) === true;
    const del = Object.getOwnPropertyNames(ProductsController.prototype).find((m) => marked(ProductsController.prototype, m));
    expect(del).toBeDefined();
    expect(Object.getOwnPropertyNames(CampaignsAdminController.prototype).filter((m) => marked(CampaignsAdminController.prototype, m)).length).toBe(3);
    expect(Object.getOwnPropertyNames(ProfilePhotoController.prototype).some((m) => marked(ProfilePhotoController.prototype, m))).toBe(false);
  });
});

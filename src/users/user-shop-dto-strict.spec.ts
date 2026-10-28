import 'reflect-metadata';
import { BadRequestException, Logger } from '@nestjs/common';
import { StrictBodyPipe } from 'src/common/strict-body';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateShopDto } from 'src/shops/dto/create-shop.dto';
import { UpdateShopDto } from 'src/shops/dto/update-shop.dto';

// Audit sécurité 2.3 (28/10/2026) : DTO utilisateurs et boutiques (lot 3)
const body = (metatype: any) => ({ type: 'body' as const, metatype, data: '' });

describe('DTO utilisateurs et boutiques (lot 3)', () => {
  const pipe = new StrictBodyPipe();
  let warn: jest.SpyInstance;
  beforeEach(() => (warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)));
  afterEach(() => warn.mockRestore());

  it('profil admin : corps du formulaire gardé, avatar intact', async () => {
    const sent = {
      name: 'Awa',
      profile: { id: 3, bio: 'b', contact: '+229', notifications: { email: 'a@b.c', enable: true }, avatar: { id: 1, original: 'u', thumbnail: 'u' } },
    };
    await expect(pipe.transform(JSON.parse(JSON.stringify(sent)), body(UpdateUserDto))).resolves.toEqual(sent);
    expect(warn).not.toHaveBeenCalled();
  });

  it('mise à jour utilisateur : mot de passe, rôle et champs inconnus retirés', async () => {
    const out: any = await pipe.transform({ name: 'A', password: 'x', permission: 'Super admin', is_active: 1 }, body(UpdateUserDto));
    expect(out).toEqual({ name: 'A' });
    expect(String(warn.mock.calls[0][0])).toContain('password, permission, is_active');
  });

  it('mise à jour utilisateur : objet dans un champ simple → 400', async () => {
    await expect(pipe.transform({ email: { a: 1 } }, body(UpdateUserDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ profile: { bio: ['x'] } }, body(UpdateUserDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ profile: 'x' }, body(UpdateUserDto))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('création utilisateur (admin) : champs lus gardés, rôle texte seulement', async () => {
    const sent = {
      name: 'A', email: 'a@b.c', password: 'x', permission: 'Store owner',
      address: [{ title: 'Maison', type: 'billing', default: true, address: { city: 'Cotonou', zip: '00229' } }],
    };
    await expect(pipe.transform(JSON.parse(JSON.stringify(sent)), body(CreateUserDto))).resolves.toEqual(sent);
    await expect(pipe.transform({ name: 'A', permission: 1 }, body(CreateUserDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ address: [{ address: { city: { a: 1 } } }] }, body(CreateUserDto))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('boutique (admin) : champs lus gardés, réglages et solde non lus retirés', async () => {
    const sent = {
      name: 'B', slug: 'b', description: '<p>x</p>', website: 'w', contact: 'c',
      address: { country: 'BJ', city: 'Cotonou', state: 'L', zip: '1', street_address: 's' },
      location: { lat: 6.3, lng: 2.4, formatted_address: 'f' },
      logo_image: { url: 'u', key: 'k' },
    };
    const created: any = await pipe.transform({ ...JSON.parse(JSON.stringify(sent)), balance: {}, settings: {} }, body(CreateShopDto));
    expect(created).toEqual(sent);
    expect(String(warn.mock.calls[0][0])).toContain('balance, settings');
    const updated: any = await pipe.transform({ ...JSON.parse(JSON.stringify(sent)), cover_image: null, rating: 4 }, body(UpdateShopDto));
    expect(updated).toEqual({ ...sent, cover_image: null, rating: 4 });
  });

  it('boutique : objet dans un champ simple → 400', async () => {
    await expect(pipe.transform({ name: { a: 1 } }, body(CreateShopDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ address: { city: ['x'] } }, body(CreateShopDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ logo_image: { url: { a: 1 } } }, body(UpdateShopDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ owner_id: 5 }, body(UpdateShopDto))).resolves.toEqual({});
  });
});

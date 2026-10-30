import 'reflect-metadata';
import { BadRequestException, Logger } from '@nestjs/common';
import { IsOptional } from 'class-validator';
import { IsScalar, StrictBodyPipe, StrictDto, unknownFields } from './strict-body';
import {
  ChangePasswordDto,
  ForgetPasswordDto,
  LoginDto,
  RegisterDto,
  ResendVerificationDto,
  ResetPasswordDto,
  VerifyForgetPasswordDto,
} from 'src/auth/dto/create-auth.dto';

// Audit sécurité 2.3 (27/10/2026) : liste blanche stricte DTO par DTO
@StrictDto()
class StrictSample {
  @IsOptional() @IsScalar() a?: string;
  @IsOptional() @IsScalar() b?: number;
}

class LooseSample {
  a?: string;
}

const body = (metatype: any) => ({ type: 'body' as const, metatype, data: '' });

describe('StrictBodyPipe (2.3)', () => {
  const pipe = new StrictBodyPipe();
  let warn: jest.SpyInstance;
  beforeEach(() => (warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)));
  afterEach(() => warn.mockRestore());

  it('DTO strict : champs inconnus retirés, noms journalisés sans les valeurs', async () => {
    const out = await pipe.transform({ a: 'x', b: 2, role: 'super_admin', secret: 'valeur-privee' }, body(StrictSample));
    expect(out).toEqual({ a: 'x', b: 2 });
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain('role, secret');
    expect(msg).not.toContain('valeur-privee');
  });

  it('DTO strict : objet ou tableau dans un champ simple → 400', async () => {
    await expect(pipe.transform({ a: { $gt: '' } }, body(StrictSample))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ a: ['x'] }, body(StrictSample))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('DTO strict : null, nombre, booléen, texte acceptés ; aucun journal sans champ inconnu', async () => {
    await expect(pipe.transform({ a: null, b: 3 }, body(StrictSample))).resolves.toEqual({ a: null, b: 3 });
    await expect(pipe.transform({ a: true }, body(StrictSample))).resolves.toEqual({ a: true });
    expect(warn).not.toHaveBeenCalled();
  });

  it('DTO non marqué : comportement d\'avant (rien retiré)', async () => {
    const v = { a: 'x', other: 1 };
    await expect(pipe.transform(v, body(LooseSample))).resolves.toEqual(v);
  });

  it('paramètres hors corps et body any : inchangés', async () => {
    await expect(pipe.transform('12', { type: 'param', metatype: String, data: 'id' })).resolves.toBe('12');
    const v = { x: { y: 1 } };
    await expect(pipe.transform(v, body(Object))).resolves.toEqual(v);
  });
});

describe('DTO d\'authentification (lot 1)', () => {
  const pipe = new StrictBodyPipe();
  let warn: jest.SpyInstance;
  beforeEach(() => (warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)));
  afterEach(() => warn.mockRestore());

  it('inscription : tous les champs lus par AuthService gardés, permission retirée', async () => {
    const sent = {
      name: 'A', email: 'a@b.c', password: 'Secret123!', pickup_lat: 6.3, pickup_lng: '2.4',
      pickup_address: 'Cotonou', birth_date: '2008-01-02', sex: 'female', consent: true, permission: 'super_admin',
    };
    const { permission, ...kept } = sent;
    await expect(pipe.transform(sent, body(RegisterDto))).resolves.toEqual(kept);
  });

  it('connexion, mot de passe oublié, code, réinitialisation, changement : champs gardés', async () => {
    const cases: [any, any][] = [
      [LoginDto, { email: 'a@b.c', password: 'x' }],
      [ForgetPasswordDto, { email: 'a@b.c' }],
      [ResendVerificationDto, { email: 'a@b.c' }],
      [VerifyForgetPasswordDto, { email: 'a@b.c', token: '123456' }],
      [ResetPasswordDto, { email: 'a@b.c', token: '123456', password: 'x' }],
      [ChangePasswordDto, { oldPassword: 'a', newPassword: 'b', old_password: 'a', new_password: 'b' }],
    ];
    for (const [dto, v] of cases) {
      await expect(pipe.transform({ ...v }, body(dto))).resolves.toEqual(v);
      expect(unknownFields(dto, v)).toEqual([]);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('connexion : e-mail objet (injection mysql2) → 400', async () => {
    await expect(pipe.transform({ email: { email: 1 }, password: 'x' }, body(LoginDto))).rejects.toBeInstanceOf(BadRequestException);
  });
});

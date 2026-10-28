import 'reflect-metadata';
import { BadRequestException, Logger } from '@nestjs/common';
import { StrictBodyPipe } from './strict-body';
import { ApplyCommissionDto } from 'src/commissions/dto/apply-commission.dto';
import { SetFontDto } from 'src/site-appearance/dto/set-font.dto';
import { AssignCourierDto, CourierActionDto, CourierOpenDto, DeliverySettingsDto } from 'src/delivery/dto/delivery-body.dto';
import { UpdateMyProfileDto } from 'src/users/dto/update-my-profile.dto';

// Audit sécurité 2.3 (28/10/2026) : routes @Body any — commissions, police, livraison, profil (lot 7)
const body = (metatype: any) => ({ type: 'body' as const, metatype, data: '' });

describe('Routes @Body any (lot 7)', () => {
  const pipe = new StrictBodyPipe();
  let warn: jest.SpyInstance;
  beforeEach(() => (warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)));
  afterEach(() => warn.mockRestore());

  it('corps envoyés par le site et l\'admin gardés, sans journal', async () => {
    const id = 'a'.repeat(40);
    const cases: [any, any][] = [
      [ApplyCommissionDto, { value: 5, scope: 'selected', pickup_point_ids: [3, 4] }],
      [ApplyCommissionDto, { value: 5, scope: 'all', pickup_point_ids: [] }],
      [SetFontDto, { font: 'poppins' }],
      [CourierOpenDto, { device_id: id }],
      [CourierActionDto, { device_id: id, pin: '1234' }],
      [CourierActionDto, { device_id: id, pin: '1234', otp: '654321' }],
      [AssignCourierDto, { courier_name: 'Koffi', courier_phone: '+22901000000' }],
      [DeliverySettingsDto, { price_per_km: 150, center_lat: 6.37, center_lng: 2.39 }],
      [UpdateMyProfileDto, { name: 'Awa Dossou', phone: '+229 01', birth_date: '2008-01-02', sex: 'female' }],
    ];
    for (const [dto, v] of cases) {
      await expect(pipe.transform(JSON.parse(JSON.stringify(v)), body(dto))).resolves.toEqual(v);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('objet ou tableau dans un champ simple → 400', async () => {
    await expect(pipe.transform({ value: { a: 1 }, scope: 'all' }, body(ApplyCommissionDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ scope: 'selected', pickup_point_ids: [{ a: 1 }] }, body(ApplyCommissionDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ scope: 'selected', pickup_point_ids: 3 }, body(ApplyCommissionDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ font: ['poppins'] }, body(SetFontDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ device_id: 'x', pin: { $ne: '' } }, body(CourierActionDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ name: { a: 1 } }, body(UpdateMyProfileDto))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('profil : rôle et champs verrouillés non déclarés retirés', async () => {
    await expect(pipe.transform({ name: 'A', role: 'super_admin', is_active: 1 }, body(UpdateMyProfileDto))).resolves.toEqual({ name: 'A' });
  });
});

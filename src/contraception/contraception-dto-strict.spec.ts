import 'reflect-metadata';
import { BadRequestException, Logger } from '@nestjs/common';
import { StrictBodyPipe } from 'src/common/strict-body';
import {
  ContraceptionAcceptDto,
  ContraceptionFollowupDto,
  ContraceptionMethodActiveDto,
  ContraceptionMethodDto,
  ContraceptionRefuseDto,
  ContraceptionRequestDto,
} from './dto/contraception-body.dto';

// Audit sécurité 2.3 (28/10/2026) : contraception (lot 9)
const body = (metatype: any) => ({ type: 'body' as const, metatype, data: '' });

describe('DTO contraception (lot 9)', () => {
  const pipe = new StrictBodyPipe();
  let warn: jest.SpyInstance;
  beforeEach(() => (warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)));
  afterEach(() => warn.mockRestore());

  it('corps envoyés par le site et l\'admin gardés, sans journal', async () => {
    const method = {
      name: 'Implant', family: 'Hormonal', requires_doctor: true, summary: 's', description: 'd', how_to: 'h',
      advantages: ['a', 'b'], drawbacks: [''], criteria: ['c'], efficacy: '99 %', duration: '3 ans', protects_sti: false,
      image_url: 'https://x/y.jpg', image_credit: '', sort_order: 2,
    };
    const cases: [any, any][] = [
      [ContraceptionRequestDto, { method_id: 3, note: 'n' }],
      [ContraceptionFollowupDto, { content: 'c' }],
      [ContraceptionAcceptDto, { note: '', center_id: '' }],
      [ContraceptionAcceptDto, { note: 'n', center_id: '4' }],
      [ContraceptionRefuseDto, { reason: 'r' }],
      [ContraceptionMethodDto, method],
      [ContraceptionMethodDto, { ...method, advantages: 'a\nb' }],
      [ContraceptionMethodActiveDto, { active: false }],
    ];
    for (const [dto, v] of cases) {
      await expect(pipe.transform(JSON.parse(JSON.stringify(v)), body(dto))).resolves.toEqual(v);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('objet dans un champ simple ou une liste → 400', async () => {
    const bad: [any, any][] = [
      [ContraceptionRequestDto, { method_id: { a: 1 } }],
      [ContraceptionFollowupDto, { content: ['x'] }],
      [ContraceptionAcceptDto, { center_id: { a: 1 } }],
      [ContraceptionMethodDto, { name: { a: 1 } }],
      [ContraceptionMethodDto, { advantages: [{ a: 1 }] }],
      [ContraceptionMethodDto, { criteria: { a: 1 } }],
    ];
    for (const [dto, v] of bad) {
      await expect(pipe.transform(v, body(dto))).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('champs inconnus retirés', async () => {
    await expect(pipe.transform({ method_id: 1, user_id: 9, status: 'accepted' }, body(ContraceptionRequestDto))).resolves.toEqual({ method_id: 1 });
    await expect(pipe.transform({ name: 'X', id: 3, is_active: 1 }, body(ContraceptionMethodDto))).resolves.toEqual({ name: 'X' });
  });
});

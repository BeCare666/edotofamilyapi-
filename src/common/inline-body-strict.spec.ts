import 'reflect-metadata';
import { BadRequestException, Logger } from '@nestjs/common';
import { StrictBodyPipe } from './strict-body';
import { ApproveShopDto, IdBodyDto } from './dto/id-body.dto';
import { CompleteFeexPayDto } from 'src/payment-intent/dto/complete-feexpay.dto';
import { MarkPickupDto, VerifyCampaignOtpDto } from 'src/campaigns/dto/pickup-otp.dto';

// Audit sécurité 2.3 (28/10/2026) : corps typés en ligne et @Body('id') (lot 6)
const body = (metatype: any) => ({ type: 'body' as const, metatype, data: '' });

describe('Corps en ligne et { id } (lot 6)', () => {
  const pipe = new StrictBodyPipe();
  let warn: jest.SpyInstance;
  beforeEach(() => (warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)));
  afterEach(() => warn.mockRestore());

  it('corps envoyés par le site et l\'admin gardés, sans journal', async () => {
    const cases: [any, any][] = [
      [CompleteFeexPayDto, { transaction_id: 'T1', custom_id: 'ORD-1-1', feexpay_response: { status: 'SUCCESSFUL', amount: 100, nested: { a: 1 } } }],
      [VerifyCampaignOtpDto, { registration_id: 4, otp: '123456' }],
      [MarkPickupDto, { registration_id: 4 }],
      [IdBodyDto, { id: '12' }],
      [ApproveShopDto, { id: '12', admin_commission_rate: 10, isCustomCommission: false }],
    ];
    for (const [dto, v] of cases) {
      await expect(pipe.transform(JSON.parse(JSON.stringify(v)), body(dto))).resolves.toEqual(v);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('objet dans un identifiant ou une référence de paiement → 400', async () => {
    await expect(pipe.transform({ id: { a: 1 } }, body(IdBodyDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ id: [1, 2] }, body(IdBodyDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ transaction_id: 'T', custom_id: { tracking_number: 'x' } }, body(CompleteFeexPayDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ registration_id: { a: 1 }, otp: '1' }, body(VerifyCampaignOtpDto))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('champs inconnus retirés', async () => {
    await expect(pipe.transform({ registration_id: 4, user_id: 1 }, body(MarkPickupDto))).resolves.toEqual({ registration_id: 4 });
  });
});

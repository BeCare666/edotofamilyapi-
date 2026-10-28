import 'reflect-metadata';
import { BadRequestException, Logger } from '@nestjs/common';
import { StrictBodyPipe } from './strict-body';
import { CreateTagDto } from 'src/tags/dto/create-tag.dto';
import { UpdateTagDto } from 'src/tags/dto/update-tag.dto';
import { CreateTaxDto } from 'src/taxes/dto/create-tax.dto';
import { UpdateTaxDto } from 'src/taxes/dto/update-tax.dto';
import { CreateShippingDto } from 'src/shippings/dto/create-shipping.dto';
import { CreateSettingDto } from 'src/settings/dto/create-setting.dto';
import { CreateCountryDto } from 'src/countries/dto/create-countries.dto';

// Audit sécurité 2.3 (28/10/2026) : tags, taxes, livraisons, réglages, pays (lot 4)
const body = (metatype: any) => ({ type: 'body' as const, metatype, data: '' });

describe('DTO de référence (lot 4)', () => {
  const pipe = new StrictBodyPipe();
  let warn: jest.SpyInstance;
  beforeEach(() => (warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)));
  afterEach(() => warn.mockRestore());

  it('champs lus par les services gardés, sans journal', async () => {
    const cases: [any, any][] = [
      [CreateTagDto, { name: 'T', slug: 't', language: 'fr', icon: 'i', details: 'd', type_id: 2 }],
      [UpdateTagDto, { name: 'T2' }],
      [CreateTaxDto, { name: 'TVA', rate: 18, is_global: true, country: 'BJ', state: null, zip: '1', city: 'C', priority: 1, on_shipping: false }],
      [UpdateTaxDto, { rate: 10 }],
      [CreateShippingDto, { name: 'S', amount: 500, is_global: true, type: 'fixed' }],
      [CreateCountryDto, { name: 'Bénin', slug: 'benin', code: 'BJ', iso3: 'BEN', phone_code: '+229', currency: 'XOF', continent: 'Africa', flag_url: 'f', emoji: 'e' }],
    ];
    for (const [dto, v] of cases) {
      await expect(pipe.transform({ ...v }, body(dto))).resolves.toEqual(v);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('réglages : options gardées entières (réglages du site)', async () => {
    const sent = { language: 'fr', options: { siteTitle: 'E.doto family', seo: { metaTitle: 'x' }, deliveryTime: [{ title: 'a' }] } };
    await expect(pipe.transform(JSON.parse(JSON.stringify(sent)), body(CreateSettingDto))).resolves.toEqual(sent);
    await expect(pipe.transform({ options: 'x' }, body(CreateSettingDto))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('champs inconnus retirés, objet dans un champ simple → 400', async () => {
    await expect(pipe.transform({ name: 'T', image: { id: 1 }, id: 9 }, body(CreateTagDto))).resolves.toEqual({ name: 'T' });
    await expect(pipe.transform({ rate: { a: 1 } }, body(UpdateTaxDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ code: ['BJ'] }, body(CreateCountryDto))).rejects.toBeInstanceOf(BadRequestException);
  });
});

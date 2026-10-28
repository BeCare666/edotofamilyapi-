import 'reflect-metadata';
import { BadRequestException, Logger } from '@nestjs/common';
import { StrictBodyPipe } from 'src/common/strict-body';
import {
  AdminDecisionDto,
  SponsorInvitationAcceptDto,
  SponsorProfileDto,
  SponsorProposalDto,
  SponsorSignupDto,
} from './dto/sponsor-body.dto';
import { CampaignInputDto, CreateSponsorDto, EligibilityDto, LocateDto } from 'src/campaigns/dto/campaign-body.dto';

// Audit sécurité 2.3 (28/10/2026) : sponsors et campagnes (lot 8)
const body = (metatype: any) => ({ type: 'body' as const, metatype, data: '' });

describe('DTO sponsors et campagnes (lot 8)', () => {
  const pipe = new StrictBodyPipe();
  let warn: jest.SpyInstance;
  beforeEach(() => (warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)));
  afterEach(() => warn.mockRestore());

  it('corps envoyés par le site et l\'admin gardés, sans journal', async () => {
    const cases: [any, any][] = [
      [SponsorSignupDto, { organization: 'ONG', contact_name: 'Awa D', phone: '+22901', email: 'a@b.c', password: 'Secret123!' }],
      [SponsorInvitationAcceptDto, { token: 't', password: 'Secret123!' }],
      [SponsorProfileDto, { contact_name: 'Awa D', phone: '+22901' }],
      [SponsorProposalDto, { title: 'T', description: '', cities: ['Cotonou'], date_start: '2026-11-01', date_end: '2026-12-01', objective_kits: 10, budget: 0 }],
      [AdminDecisionDto, { note: 'ok' }],
      [AdminDecisionDto, { reason: 'non' }],
      [AdminDecisionDto, {}],
      [CampaignInputDto, {
        title: 'T', objective_kits: 100, date_start: '2026-11-01', date_end: '2026-12-01', description: 'd', image_url: 'u',
        cities: ['Cotonou', 'Parakou'], sponsors: [{ sponsor_id: 2, amount: 1000 }], target_sex: 'all', target_age_min: null, target_age_max: 24, proposal_id: 7,
      }],
      [CreateSponsorDto, { name: 'S', email: 's@b.c' }],
      [EligibilityDto, { device_id: 'abc', device_fingerprint: null }],
      [LocateDto, { lat: 6.37, lng: 2.39 }],
    ];
    for (const [dto, v] of cases) {
      await expect(pipe.transform(JSON.parse(JSON.stringify(v)), body(dto))).resolves.toEqual(v);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('objet ou tableau dans un champ simple → 400', async () => {
    const bad: [any, any][] = [
      [SponsorSignupDto, { email: { a: 1 } }],
      [SponsorInvitationAcceptDto, { token: ['t'] }],
      [SponsorProposalDto, { cities: [{ a: 1 }] }],
      [SponsorProposalDto, { cities: 'Cotonou' }],
      [CampaignInputDto, { sponsors: [{ sponsor_id: { a: 1 } }] }],
      [CampaignInputDto, { sponsors: [3] }],
      [CampaignInputDto, { title: { a: 1 } }],
      [LocateDto, { lat: [1] }],
    ];
    for (const [dto, v] of bad) {
      await expect(pipe.transform(v, body(dto))).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('champs inconnus retirés (dont dans les sponsors d\'une campagne)', async () => {
    const out: any = await pipe.transform({ title: 'T', status: 'en_cours', sponsors: [{ sponsor_id: 1, amount: 0, x: 1 }] }, body(CampaignInputDto));
    expect(out).toEqual({ title: 'T', sponsors: [{ sponsor_id: 1, amount: 0 }] });
    await expect(pipe.transform({ contact_name: 'A', email: 'x@y.z' }, body(SponsorProfileDto))).resolves.toEqual({ contact_name: 'A' });
  });
});

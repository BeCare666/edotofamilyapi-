import 'reflect-metadata';
import { BadRequestException, Logger } from '@nestjs/common';
import { StrictBodyPipe } from 'src/common/strict-body';
import {
  TcActiveDto,
  TcBookDto,
  TcCenterDto,
  TcDoctorDto,
  TcInvitationAcceptDto,
  TcReasonDto,
  TcReferralCompleteDto,
  TcReportDto,
  TcScheduleDto,
  TcTimeOffDto,
} from './dto/tc-body.dto';

// Audit sécurité 2.3 (28/10/2026) : téléconsultation (lot 10)
const body = (metatype: any) => ({ type: 'body' as const, metatype, data: '' });

describe('DTO téléconsultation (lot 10)', () => {
  const pipe = new StrictBodyPipe();
  let warn: jest.SpyInstance;
  beforeEach(() => (warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)));
  afterEach(() => warn.mockRestore());

  it('corps envoyés par le site et l\'admin gardés, sans journal', async () => {
    const report = {
      request_type: '', request_detail: '', chief_complaint: 'c', history: '', gyneco_history: '', allergies: '', current_treatments: '',
      findings: '', assessment: '', plan: '', urgency: 'routine', center_id: '', center_instructions: '', patient_summary: 'p', adoption_conclusion: '',
    };
    const cases: [any, any][] = [
      [TcInvitationAcceptDto, { token: 't', password: 'p' }],
      [TcBookDto, { mode: 'video', starts_at: '2026-11-02T09:00:00', doctor_id: 2, phone: '+229', reason: 'r', contraception_request_id: null }],
      [TcReasonDto, { reason: 'r' }],
      [TcReasonDto, {}],
      [TcReportDto, report],
      [TcScheduleDto, { rules: [{ weekday: 1, start_time: '09:00', end_time: '12:00', modes: 'both', id: 4 }], slot_minutes: 30 }],
      [TcTimeOffDto, { date_from: '2026-11-01', date_to: '2026-11-03', reason: '' }],
      [TcReferralCompleteDto, { note: 'n', outcome: 'done' }],
      [TcDoctorDto, { name: 'Dr A', email: 'a@b.c', phone: '', title: '', bio: '', slot_minutes: '30', is_house: false }],
      [TcCenterDto, { name: 'C', organization: 'abpf', email: '', phone: '', city: 'Cotonou', address: '', services: '', opening_hours: '', lat: '', lng: '' }],
      [TcActiveDto, { active: true }],
    ];
    for (const [dto, v] of cases) {
      await expect(pipe.transform(JSON.parse(JSON.stringify(v)), body(dto))).resolves.toEqual(v);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('objet dans un champ simple ou plages non tableau → 400', async () => {
    const bad: [any, any][] = [
      [TcInvitationAcceptDto, { token: { a: 1 } }],
      [TcBookDto, { doctor_id: { a: 1 } }],
      [TcReportDto, { findings: ['x'] }],
      [TcScheduleDto, { rules: { weekday: 1 } }],
      [TcDoctorDto, { email: { a: 1 } }],
      [TcCenterDto, { lat: [6] }],
    ];
    for (const [dto, v] of bad) {
      await expect(pipe.transform(v, body(dto))).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('champs inconnus retirés', async () => {
    await expect(pipe.transform({ mode: 'phone', patient_id: 9, status: 'done' }, body(TcBookDto))).resolves.toEqual({ mode: 'phone' });
    await expect(pipe.transform({ name: 'Dr', is_active: 1, account_status: 'active' }, body(TcDoctorDto))).resolves.toEqual({ name: 'Dr' });
  });
});

import { IsArray, IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';

// Audit sécurité 2.3 (28/10/2026, lot 10) : corps des routes de téléconsultation. Les contrôles
// métier (cleanText, cleanPhone, parseMode, cleanAvailability, parseDoctor, parseCenter) restent
// dans TeleconsultationService et TcAdminService.

// Site espace/activation.js
@StrictDto()
export class TcInvitationAcceptDto {
  @IsOptional() @IsScalar() token: string;
  @IsOptional() @IsScalar() password: string;
}

// Site teleconsultation/BookingDrawer.jsx
@StrictDto()
export class TcBookDto {
  @IsOptional() @IsScalar() mode: string;
  @IsOptional() @IsScalar() starts_at: string;
  @IsOptional() @IsScalar() doctor_id?: number;
  @IsOptional() @IsScalar() phone?: string;
  @IsOptional() @IsScalar() reason?: string;
  @IsOptional() @IsScalar() contraception_request_id?: number;
}

// Annulations (patient, médecin, admin)
@StrictDto()
export class TcReasonDto {
  @IsOptional() @IsScalar() reason?: string;
}

// Site DoctorViews.jsx (compte rendu : EMPTY_REPORT)
@StrictDto()
export class TcReportDto {
  @IsOptional() @IsScalar() request_type?: string;
  @IsOptional() @IsScalar() request_detail?: string;
  @IsOptional() @IsScalar() chief_complaint?: string;
  @IsOptional() @IsScalar() history?: string;
  @IsOptional() @IsScalar() gyneco_history?: string;
  @IsOptional() @IsScalar() allergies?: string;
  @IsOptional() @IsScalar() current_treatments?: string;
  @IsOptional() @IsScalar() findings?: string;
  @IsOptional() @IsScalar() assessment?: string;
  @IsOptional() @IsScalar() plan?: string;
  @IsOptional() @IsScalar() urgency?: string;
  @IsOptional() @IsScalar() center_id?: number | string;
  @IsOptional() @IsScalar() center_instructions?: string;
  @IsOptional() @IsScalar() patient_summary?: string;
  @IsOptional() @IsScalar() adoption_conclusion?: string;
}

// Site DoctorViews.jsx et admin doctors.tsx (plages : weekday, start_time, end_time, modes)
@StrictDto()
export class TcScheduleDto {
  @IsOptional() @IsArray() rules: any[];
  @IsOptional() @IsScalar() slot_minutes?: number;
}

@StrictDto()
export class TcTimeOffDto {
  @IsOptional() @IsScalar() date_from: string;
  @IsOptional() @IsScalar() date_to: string;
  @IsOptional() @IsScalar() reason?: string;
}

// Site centre.js
@StrictDto()
export class TcReferralCompleteDto {
  @IsOptional() @IsScalar() outcome: string;
  @IsOptional() @IsScalar() note?: string;
}

// Admin teleconsultation/doctors.tsx
@StrictDto()
export class TcDoctorDto {
  @IsOptional() @IsScalar() name: string;
  @IsOptional() @IsScalar() email: string;
  @IsOptional() @IsScalar() phone?: string;
  @IsOptional() @IsScalar() title?: string;
  @IsOptional() @IsScalar() bio?: string;
  @IsOptional() @IsScalar() slot_minutes?: number | string;
  @IsOptional() @IsScalar() is_house?: boolean;
}

// Admin teleconsultation/centers.tsx
@StrictDto()
export class TcCenterDto {
  @IsOptional() @IsScalar() name: string;
  @IsOptional() @IsScalar() organization?: string;
  @IsOptional() @IsScalar() email?: string;
  @IsOptional() @IsScalar() phone?: string;
  @IsOptional() @IsScalar() city?: string;
  @IsOptional() @IsScalar() address?: string;
  @IsOptional() @IsScalar() services?: string;
  @IsOptional() @IsScalar() opening_hours?: string;
  @IsOptional() @IsScalar() lat?: number | string;
  @IsOptional() @IsScalar() lng?: number | string;
}

@StrictDto()
export class TcActiveDto {
  @IsOptional() @IsScalar() active: boolean;
}

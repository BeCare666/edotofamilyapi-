import { IsArray, IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';

// Audit sécurité 2.3 (28/10/2026, lot 8) : corps des routes sponsors. Les contrôles métier
// (parseSponsorSignup, parseNewPassword, parseSponsorProfile, parseProposal) restent en place.

// Site sponsor/inscription.js
@StrictDto()
export class SponsorSignupDto {
  @IsOptional() @IsScalar() organization: string;
  @IsOptional() @IsScalar() contact_name: string;
  @IsOptional() @IsScalar() phone: string;
  @IsOptional() @IsScalar() email: string;
  @IsOptional() @IsScalar() password: string;
}

// Site sponsor/activation.js
@StrictDto()
export class SponsorInvitationAcceptDto {
  @IsOptional() @IsScalar() token: string;
  @IsOptional() @IsScalar() password: string;
}

// Site sponsor-dashboard/proposals.jsx (coordonnées)
@StrictDto()
export class SponsorProfileDto {
  @IsOptional() @IsScalar() contact_name: string;
  @IsOptional() @IsScalar() phone: string;
}

// Site sponsor-dashboard/proposals.jsx (demande de campagne)
@StrictDto()
export class SponsorProposalDto {
  @IsOptional() @IsScalar() title: string;
  @IsOptional() @IsScalar() description?: string;
  @IsOptional() @IsArray() @IsScalar({ each: true }) cities: string[];
  @IsOptional() @IsScalar() date_start: string;
  @IsOptional() @IsScalar() date_end: string;
  @IsOptional() @IsScalar() objective_kits: number;
  @IsOptional() @IsScalar() budget?: number;
}

// Admin campaign-proposals/index.tsx et sponsor-exports/index.tsx
@StrictDto()
export class AdminDecisionDto {
  @IsOptional() @IsScalar() note?: string;
  @IsOptional() @IsScalar() reason?: string;
}

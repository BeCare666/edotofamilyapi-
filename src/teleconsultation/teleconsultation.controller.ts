import { Body, Controller, Delete, Get, HttpException, HttpStatus, Param, ParseIntPipe, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import * as QRCode from 'qrcode';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CUSTOMER, DOCTOR, HEALTH_CENTER, Roles, SUPER_ADMIN } from '../auth/roles.decorator';
import { allowAttempt } from '../sponsors/sponsor-rules';
import { TeleconsultationService } from './teleconsultation.service';
import { TcAdminService } from './tc-admin.service';

// Public : calendrier des créneaux libres, page du code QR (sans donnée de santé), image du code QR,
// invitations des médecins et des centres
@Controller('teleconsultation')
export class TcPublicController {
  constructor(private readonly tc: TeleconsultationService) {}

  @Get('availability')
  availability(@Query() q: any) {
    return this.tc.availability(q);
  }

  @Get('qr/:file')
  async qrImage(@Param('file') file: string, @Res() res: Response) {
    const token = String(file).replace(/\.png$/, '');
    const target = await this.tc.qrTarget(token);
    const png = await QRCode.toBuffer(target, { type: 'png', width: 720, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#1A1814', light: '#FFFFFF' } });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    if (String((res.req as any)?.query?.download) === '1') res.setHeader('Content-Disposition', 'attachment; filename="code-qr-edoto-family.png"');
    res.end(png);
  }

  @Get('qr-info/:token')
  qrInfo(@Param('token') token: string) {
    return this.tc.qrInfo(token);
  }

  @Get('invitations/:token')
  invitation(@Param('token') token: string) {
    return this.tc.invitationInfo(token);
  }

  @Post('invitations/accept')
  accept(@Body() body: any) {
    return this.tc.acceptInvitation(body);
  }
}

// Jeune connecté (compte client) : réserver, voir ses rendez-vous et ses orientations
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(CUSTOMER)
@Controller('teleconsultation/me')
export class TcPatientController {
  constructor(private readonly tc: TeleconsultationService) {}

  @Post('appointments')
  book(@Req() req: any, @Body() body: any) {
    if (!allowAttempt(`tc-book:${req.user.id}`, 10, 60 * 60 * 1000)) {
      throw new HttpException('Trop de tentatives. Réessayez dans une heure.', HttpStatus.TOO_MANY_REQUESTS);
    }
    return this.tc.book(Number(req.user.id), body);
  }

  @Get('appointments')
  appointments(@Req() req: any) {
    return this.tc.myAppointments(Number(req.user.id));
  }

  @Post('appointments/:id/cancel')
  cancel(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.tc.cancelByPatient(Number(req.user.id), id, body);
  }

  @Get('referrals')
  referrals(@Req() req: any) {
    return this.tc.myReferrals(Number(req.user.id));
  }
}

// Espace médecin
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(DOCTOR)
@Controller('teleconsultation/doctor')
export class TcDoctorController {
  constructor(private readonly tc: TeleconsultationService) {}

  @Get('overview')
  overview(@Req() req: any) {
    return this.tc.doctorOverview(Number(req.user.id));
  }

  @Get('appointments')
  appointments(@Req() req: any, @Query() q: any) {
    return this.tc.doctorAppointments(Number(req.user.id), q);
  }

  @Get('appointments/:id')
  appointment(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.tc.doctorAppointment(Number(req.user.id), id);
  }

  @Post('appointments/:id/start')
  start(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.tc.doctorStart(Number(req.user.id), id);
  }

  @Post('appointments/:id/no-show')
  noShow(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.tc.doctorNoShow(Number(req.user.id), id);
  }

  @Post('appointments/:id/cancel')
  cancel(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.tc.doctorCancel(Number(req.user.id), id, body);
  }

  @Put('appointments/:id/report')
  saveDraft(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.tc.saveReport(Number(req.user.id), id, body, false);
  }

  @Post('appointments/:id/report/finalize')
  finalize(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.tc.saveReport(Number(req.user.id), id, body, true);
  }

  @Get('schedule')
  schedule(@Req() req: any) {
    return this.tc.doctorSchedule(Number(req.user.id));
  }

  @Put('schedule')
  saveSchedule(@Req() req: any, @Body() body: any) {
    return this.tc.doctorSaveSchedule(Number(req.user.id), body);
  }

  @Post('time-off')
  addTimeOff(@Req() req: any, @Body() body: any) {
    return this.tc.doctorAddTimeOff(Number(req.user.id), body);
  }

  @Delete('time-off/:id')
  deleteTimeOff(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.tc.doctorDeleteTimeOff(Number(req.user.id), id);
  }
}

// Espace centre : dossiers des jeunes orientés vers ce centre uniquement
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(HEALTH_CENTER)
@Controller('teleconsultation/center')
export class TcCenterController {
  constructor(private readonly tc: TeleconsultationService) {}

  private guard(req: any) {
    // Saisie des codes limitée : 60 ouvertures de dossier par heure et par compte
    if (!allowAttempt(`tc-dossier:${req.user.id}`, 60, 60 * 60 * 1000)) {
      throw new HttpException('Trop de codes saisis. Réessayez dans une heure.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  @Get('overview')
  overview(@Req() req: any) {
    return this.tc.centerOverview(Number(req.user.id));
  }

  @Get('referrals')
  referrals(@Req() req: any, @Query() q: any) {
    return this.tc.centerReferrals(Number(req.user.id), q);
  }

  @Get('dossier/token/:token')
  byToken(@Req() req: any, @Param('token') token: string) {
    this.guard(req);
    return this.tc.centerDossier(Number(req.user.id), { token });
  }

  @Get('dossier/code/:code')
  byCode(@Req() req: any, @Param('code') code: string) {
    this.guard(req);
    return this.tc.centerDossier(Number(req.user.id), { code });
  }

  @Post('referrals/:id/complete')
  complete(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.tc.centerComplete(Number(req.user.id), id, body);
  }
}

// Super admin
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SUPER_ADMIN)
@Controller('admin/teleconsultation')
export class TcAdminController {
  constructor(private readonly admin: TcAdminService, private readonly tc: TeleconsultationService) {}

  @Get('summary')
  summary() {
    return this.admin.summary();
  }

  @Get('doctors')
  doctors() {
    return this.admin.doctors();
  }

  @Post('doctors')
  createDoctor(@Body() body: any) {
    return this.admin.createDoctor(body);
  }

  @Put('doctors/:id')
  updateDoctor(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.admin.updateDoctor(id, body);
  }

  @Patch('doctors/:id/active')
  doctorActive(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.admin.setDoctorActive(id, Boolean(body?.active));
  }

  @Post('doctors/:id/invite')
  inviteDoctor(@Param('id', ParseIntPipe) id: number) {
    return this.tc.invite('doctor', id);
  }

  @Get('centers')
  centers() {
    return this.admin.centers();
  }

  @Post('centers')
  createCenter(@Body() body: any) {
    return this.admin.createCenter(body);
  }

  @Put('centers/:id')
  updateCenter(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.admin.updateCenter(id, body);
  }

  @Patch('centers/:id/active')
  centerActive(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.admin.setCenterActive(id, Boolean(body?.active));
  }

  @Post('centers/:id/invite')
  inviteCenter(@Param('id', ParseIntPipe) id: number) {
    return this.tc.invite('center', id);
  }

  @Get('appointments')
  appointments(@Query() q: any) {
    return this.admin.appointments(q);
  }

  @Get('appointments/facets')
  appointmentFacets(@Query() q: any) {
    return this.admin.appointmentFacets(q);
  }

  @Post('appointments/:id/cancel')
  cancelAppointment(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.admin.cancelAppointment(id, body);
  }

  @Get('referrals')
  referrals(@Query() q: any) {
    return this.admin.referrals(q);
  }

  @Get('referrals/facets')
  referralFacets() {
    return this.admin.referralFacets();
  }
}

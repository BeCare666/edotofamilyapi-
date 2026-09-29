import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, SPONSOR, SUPER_ADMIN } from '../auth/roles.decorator';
import { SponsorAccountService } from './sponsor-account.service';
import { SponsorSpaceService } from './sponsor-space.service';
import { SponsorExportsAdminService } from './sponsor-exports-admin.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Public : lien d'invitation (secret aléatoire, 7 jours)
@Controller('sponsor-invitations')
export class SponsorInvitationsController {
  constructor(private readonly accounts: SponsorAccountService) { }

  @Get(':token')
  info(@Param('token') token: string) {
    return this.accounts.invitationInfo(token);
  }

  @Post('accept')
  accept(@Body() body: any) {
    return this.accounts.accept(body);
  }
}

// Espace sponsor : rôle sponsor, fiche sponsor retrouvée à partir du jeton
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SPONSOR)
@Controller('sponsor')
export class SponsorSpaceController {
  constructor(private readonly space: SponsorSpaceService) { }

  private sponsor(req: any) {
    return this.space.sponsorFor(Number(req.user.id));
  }

  @Get('me')
  me(@Req() req: any) {
    return this.sponsor(req);
  }

  @Get('summary')
  async summary(@Req() req: any) {
    return this.space.summary((await this.sponsor(req)).id);
  }

  // ?status=a_venir|en_cours|terminee&q
  @Get('campaigns')
  async campaigns(@Req() req: any, @Query() query: any) {
    return this.space.campaigns((await this.sponsor(req)).id, query);
  }

  @Get('campaigns/:id')
  async analytics(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.space.analytics((await this.sponsor(req)).id, id);
  }

  @Post('campaigns/:id/export-request')
  async requestExport(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.space.requestExport((await this.sponsor(req)).id, id);
  }

  @Get('campaigns/:id/export')
  async download(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const file = await this.space.download((await this.sponsor(req)).id, id);
    res.setHeader('Content-Type', XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Content-Length', String(file.buffer.length));
    res.end(file.buffer);
  }

  @Get('exports')
  async exports(@Req() req: any) {
    return this.space.exports((await this.sponsor(req)).id);
  }

  @Get('notifications')
  async notifications(@Req() req: any) {
    return this.space.notifications((await this.sponsor(req)).id);
  }
}

// Admin : invitation des sponsors et validation des demandes d'export
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SUPER_ADMIN)
@Controller('admin')
export class SponsorsAdminController {
  constructor(
    private readonly accounts: SponsorAccountService,
    private readonly exportsAdmin: SponsorExportsAdminService,
  ) { }

  @Post('sponsors/:id/invite')
  invite(@Param('id', ParseIntPipe) id: number) {
    return this.accounts.invite(id);
  }

  // ?status=pending|approved|rejected
  @Get('sponsor-exports')
  list(@Query('status') status?: string) {
    return this.exportsAdmin.list(status);
  }

  @Post('sponsor-exports/:id/approve')
  approve(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.exportsAdmin.approve(id, Number(req.user.id));
  }

  @Post('sponsor-exports/:id/reject')
  reject(@Param('id', ParseIntPipe) id: number, @Req() req: any, @Body() body: any) {
    return this.exportsAdmin.reject(id, Number(req.user.id), body?.reason);
  }
}

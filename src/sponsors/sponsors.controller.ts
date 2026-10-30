import { Body, Controller, Delete, Get, HttpException, HttpStatus, Param, ParseIntPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, SPONSOR, SUPER_ADMIN } from '../auth/roles.decorator';
import { SponsorAccountService } from './sponsor-account.service';
import { SponsorSpaceService } from './sponsor-space.service';
import { SponsorExportsAdminService } from './sponsor-exports-admin.service';
import { SponsorProposalsService } from './sponsor-proposals.service';
import { SponsorLiveService } from './sponsor-live.service';
import { allowAttempt } from './sponsor-rules';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_SENSITIVE } from '../common/client-throttler.guard';
import { clientIp } from '../ai/chat/ai-chat.rate-limit';
import { Public } from '../auth/public.decorator';
import { realClientIp } from '../common/client-ip';
import { AdminDecisionDto, SponsorInvitationAcceptDto, SponsorProfileDto, SponsorProposalDto, SponsorSignupDto } from './dto/sponsor-body.dto';
import { SensitiveAction } from '../auth/step-up';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Public : lien d'invitation (secret aléatoire, 7 jours)
@Controller('sponsor-invitations')
export class SponsorInvitationsController {
  constructor(private readonly accounts: SponsorAccountService) { }

  @Public()
  @Get(':token')
  info(@Param('token') token: string) {
    return this.accounts.invitationInfo(token);
  }

  @Public()
  @Post('accept')
  accept(@Body() body: SponsorInvitationAcceptDto) {
    return this.accounts.accept(body);
  }
}

// Public : inscription libre d'un sponsor (15/10/2026) ; 5 essais par heure et par adresse IP
@Controller('sponsor-signup')
export class SponsorSignupController {
  constructor(private readonly accounts: SponsorAccountService) { }

  @Public()
  @Throttle(THROTTLE_SENSITIVE)
  @Post()
  signup(@Req() req: any, @Body() body: SponsorSignupDto) {
    if (!allowAttempt(`signup:${clientIp(req)}`, 5, 60 * 60 * 1000)) {
      throw new HttpException('Trop de tentatives. Réessayez dans une heure.', HttpStatus.TOO_MANY_REQUESTS);
    }
    return this.accounts.signup(body, realClientIp(req));
  }
}

// Espace sponsor : rôle sponsor, fiche sponsor retrouvée à partir du jeton
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SPONSOR)
@Controller('sponsor')
export class SponsorSpaceController {
  constructor(
    private readonly space: SponsorSpaceService,
    private readonly live: SponsorLiveService,
    private readonly proposals: SponsorProposalsService,
  ) { }

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

  // ---- Suivi en temps réel et analyses (15/10/2026)
  @Get('filters')
  async filters(@Req() req: any) {
    return this.live.filters((await this.sponsor(req)).id);
  }

  // ?campaign=&status=en_cours|a_venir|terminee|all
  @Get('live')
  async liveMap(@Req() req: any, @Query() query: any) {
    return this.live.live((await this.sponsor(req)).id, query);
  }

  // ?campaign=&status=&type=registration|validated|withdrawn&city=&point=&from=&to=&page=&limit=
  @Get('activity')
  async activity(@Req() req: any, @Query() query: any) {
    return this.live.activity((await this.sponsor(req)).id, query);
  }

  // ?campaign=&status=&q=&sort=withdrawn|rate|recent|name
  @Get('pickup-points')
  async points(@Req() req: any, @Query() query: any) {
    return this.live.points((await this.sponsor(req)).id, query);
  }

  // ?campaign=&status=&sort=withdrawn|rate|name
  @Get('cities')
  async cities(@Req() req: any, @Query() query: any) {
    return this.live.cities((await this.sponsor(req)).id, query);
  }

  @Patch('profile')
  async profile(@Req() req: any, @Body() body: SponsorProfileDto) {
    return this.space.updateProfile((await this.sponsor(req)).id, body);
  }

  // ---- Demandes de campagne
  // ?status=pending|approved|rejected|created&q=&city=&from=&to=&sort=recent|oldest|start|kits|budget
  @Get('proposals')
  async proposalsList(@Req() req: any, @Query() query: any) {
    return this.proposals.listForSponsor((await this.sponsor(req)).id, query);
  }

  @Get('proposals/facets')
  async proposalsFacets(@Req() req: any) {
    return this.proposals.facetsForSponsor((await this.sponsor(req)).id);
  }

  @Get('proposals/:id')
  async proposal(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.proposals.oneForSponsor((await this.sponsor(req)).id, id);
  }

  @Post('proposals')
  async createProposal(@Req() req: any, @Body() body: SponsorProposalDto) {
    return this.proposals.create((await this.sponsor(req)).id, body);
  }

  @Delete('proposals/:id')
  async withdrawProposal(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.proposals.withdraw((await this.sponsor(req)).id, id);
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
    private readonly proposals: SponsorProposalsService,
  ) { }

  // ---- Demandes de campagne des sponsors (15/10/2026)
  // ?status=&q=&city=&sponsor=&from=&to=&sort=&page=&limit=
  @Get('campaign-proposals')
  proposalsList(@Query() query: any) {
    return this.proposals.listForAdmin(query);
  }

  // Déclarée avant campaign-proposals/:id
  @Get('campaign-proposals/facets')
  proposalsFacets() {
    return this.proposals.facetsForAdmin();
  }

  @Get('campaign-proposals/:id')
  proposal(@Param('id', ParseIntPipe) id: number) {
    return this.proposals.oneForAdmin(id);
  }

  @Post('campaign-proposals/:id/approve')
  approveProposal(@Param('id', ParseIntPipe) id: number, @Req() req: any, @Body() body: AdminDecisionDto) {
    return this.proposals.decide(id, Number(req.user.id), true, body?.note);
  }

  @Post('campaign-proposals/:id/reject')
  rejectProposal(@Param('id', ParseIntPipe) id: number, @Req() req: any, @Body() body: AdminDecisionDto) {
    return this.proposals.decide(id, Number(req.user.id), false, body?.reason);
  }

  @Post('sponsors/:id/invite')
  invite(@Param('id', ParseIntPipe) id: number) {
    return this.accounts.invite(id);
  }

  // ?status=pending|approved|rejected
  @Get('sponsor-exports')
  list(@Query('status') status?: string) {
    return this.exportsAdmin.list(status);
  }

  @SensitiveAction() // audit 3.1 : code redemandé
  @Post('sponsor-exports/:id/approve')
  approve(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.exportsAdmin.approve(id, Number(req.user.id));
  }

  @Post('sponsor-exports/:id/reject')
  reject(@Param('id', ParseIntPipe) id: number, @Req() req: any, @Body() body: AdminDecisionDto) {
    return this.exportsAdmin.reject(id, Number(req.user.id), body?.reason);
  }
}

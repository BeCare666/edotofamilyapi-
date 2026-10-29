import { Body, Controller, Get, HttpException, HttpStatus, Param, ParseIntPipe, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CUSTOMER, Roles, SUPER_ADMIN } from '../auth/roles.decorator';
import { allowAttempt } from '../sponsors/sponsor-rules';
import { ContraceptionService } from './contraception.service';
import { Public } from '../auth/public.decorator';
import { realClientIp } from '../common/client-ip';
import { ContraceptionAcceptDto, ContraceptionFollowupDto, ContraceptionMethodActiveDto, ContraceptionMethodDto, ContraceptionRefuseDto, ContraceptionRequestDto } from './dto/contraception-body.dto';

// Public : catalogue des contraceptifs et fiche détaillée
@Controller('contraception')
export class ContraceptionPublicController {
  constructor(private readonly svc: ContraceptionService) {}

  @Public()
  @Get('methods')
  methods() {
    return this.svc.methods();
  }

  @Public()
  @Get('methods/:slug')
  method(@Param('slug') slug: string) {
    return this.svc.method(slug);
  }
}

// Jeune connecté : demandes d'adoption et suivi
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(CUSTOMER)
@Controller('contraception/me')
export class ContraceptionYouthController {
  constructor(private readonly svc: ContraceptionService) {}

  @Post('requests')
  create(@Req() req: any, @Body() body: ContraceptionRequestDto) {
    if (!allowAttempt(`contra-req:${req.user.id}`, 10, 60 * 60 * 1000)) {
      throw new HttpException('Trop de tentatives. Réessayez dans une heure.', HttpStatus.TOO_MANY_REQUESTS);
    }
    return this.svc.createRequest(Number(req.user.id), body);
  }

  @Get('requests')
  mine(@Req() req: any) {
    return this.svc.myRequests(Number(req.user.id));
  }

  @Post('requests/:id/cancel')
  cancel(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.svc.cancelRequest(Number(req.user.id), id);
  }

  @Post('requests/:id/followups')
  followup(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() body: ContraceptionFollowupDto) {
    return this.svc.addYouthFollowup(Number(req.user.id), id, body);
  }
}

// Super admin : fiches et demandes
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SUPER_ADMIN)
@Controller('admin/contraception')
export class ContraceptionAdminController {
  constructor(private readonly svc: ContraceptionService) {}

  @Get('summary')
  summary() {
    return this.svc.summary();
  }

  @Get('methods')
  methods() {
    return this.svc.adminMethods();
  }

  @Post('methods')
  createMethod(@Body() body: ContraceptionMethodDto) {
    return this.svc.createMethod(body);
  }

  @Put('methods/:id')
  updateMethod(@Param('id', ParseIntPipe) id: number, @Body() body: ContraceptionMethodDto) {
    return this.svc.updateMethod(id, body);
  }

  @Patch('methods/:id/active')
  methodActive(@Param('id', ParseIntPipe) id: number, @Body() body: ContraceptionMethodActiveDto) {
    return this.svc.setMethodActive(id, Boolean(body?.active));
  }

  @Get('requests')
  requests(@Query() q: any) {
    return this.svc.adminRequests(q);
  }

  @Get('requests/:id')
  request(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.svc.adminRequest(id, Number(req.user.id), realClientIp(req));
  }

  @Post('requests/:id/accept')
  accept(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() body: ContraceptionAcceptDto) {
    return this.svc.accept(Number(req.user.id), id, body);
  }

  @Post('requests/:id/refuse')
  refuse(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() body: ContraceptionRefuseDto) {
    return this.svc.refuse(Number(req.user.id), id, body);
  }

  @Post('requests/:id/followups')
  followup(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() body: ContraceptionFollowupDto) {
    return this.svc.addAdminFollowup(Number(req.user.id), id, body);
  }
}

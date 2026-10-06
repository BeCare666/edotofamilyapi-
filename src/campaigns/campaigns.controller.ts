import { Controller, Get, Post, Patch, Body, Param, ParseIntPipe, UseGuards, Req } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { ActivePickupGuard } from '../auth/active-pickup.guard';
import { Roles, SUPER_ADMIN, SUPER_PICKUPPOINT } from '../auth/roles.decorator';
import { clientIpFrom } from './campaign-guard';

@Controller()
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) { }

  @Get('campaigns/active')
  getActive() {
    return this.campaignsService.getActiveCampaign();
  }

  @Get('campaigns/upcoming')
  getUpcoming() {
    return this.campaignsService.getUpcomingCampaigns();
  }

  @Get('campaigns/:id')
  getById(@Param('id', ParseIntPipe) id: number) {
    return this.campaignsService.getCampaignById(id);
  }

  // Chiffres publics (sans données nominatives) d'une campagne en cours ou à venir
  @Get('campaigns/:id/stats')
  getStats(@Param('id', ParseIntPipe) id: number) {
    return this.campaignsService.getPublicStats(id);
  }

  // La personne connectée peut-elle encore demander un kit (compte, appareil, connexion) ?
  @UseGuards(JwtAuthGuard)
  @Post('campaigns/:id/eligibility')
  eligibility(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req) {
    return this.campaignsService.checkEligibility(id, req.user.id, body || {}, clientIpFrom(req));
  }
  @Get('campaigns/active/city/:city')
  getActiveByCity(@Param('city') city: string) {
    return this.campaignsService.getActiveCampaignByCity(city);
  }

  @Get('campaigns/active/count')
  getActiveCount() {
    return this.campaignsService.getActiveCampaignsCount();
  }
  @UseGuards(JwtAuthGuard)
  @Post('campaigns/register')
  async register(@Body() dto: RegisterDto, @Req() req) {
    return this.campaignsService.register(dto, req.user.id, clientIpFrom(req));
  }

  // Création, modification, suppression, liste, détail et exports : CampaignsAdminController.
  // Le statut n'est plus modifiable : il est calculé à partir des dates.

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(SUPER_ADMIN)
  @Get('admin/campaigns/:id/registrations')
  getRegistrations(@Param('id', ParseIntPipe) id: number) {
    return this.campaignsService.getRegistrationsForCampaign(id);
  }

  // Inscriptions du participant connecté
  @UseGuards(JwtAuthGuard)
  @Get('campaign-registrations/mine')
  getMine(@Req() req) {
    return this.campaignsService.getMyRegistrations(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('campaign-registrations/:id/regenerate-otp')
  regenerateOtp(@Param('id', ParseIntPipe) id: number, @Req() req) {
    return this.campaignsService.regenerateRegistrationOtp(id, req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard, ActivePickupGuard)
  @Roles(SUPER_PICKUPPOINT)
  @Get('campaign-registrations/my')
  async getMyRegistrations(@Req() req) {
    // récupère les inscriptions pour le point de retrait connecté
    return this.campaignsService.getRegistrationsByPickupCenter(req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard, ActivePickupGuard)
  @Roles(SUPER_PICKUPPOINT)
  @Post('campaigns/verify-otp')
  async verifyCampaignOtp(@Body() body: { registration_id: number; otp: string }, @Req() req) {
    return this.campaignsService.verifyCampaignOtp(body, req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard, ActivePickupGuard)
  @Roles(SUPER_PICKUPPOINT)
  @Post('campaigns/mark-pickup')
  async markPickup(@Body() body: { registration_id: number }, @Req() req) {
    return this.campaignsService.markPickup(body, req.user.id);
  }
}

import { Controller, Get, Post, Patch, Body, Param, ParseIntPipe, UseGuards, Req } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

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

  @UseGuards(JwtAuthGuard)
  @Post('campaigns/register')
  async register(@Body() dto: RegisterDto, @Req() req) {
    return this.campaignsService.register(dto, req.user.id);
  }

  @Post('admin/campaigns')
  create(@Body() dto: CreateCampaignDto) {
    return this.campaignsService.createCampaign(dto);
  }

  @Patch('admin/campaigns/:id/status')
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStatusDto
  ) {
    return this.campaignsService.updateStatus(id, dto);
  }

  @Get('admin/campaigns/:id/registrations')
  getRegistrations(@Param('id', ParseIntPipe) id: number) {
    return this.campaignsService.getRegistrationsForCampaign(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('campaign-registrations/my')
  async getMyRegistrations(@Req() req) {
    // récupère les inscriptions pour le point de retrait connecté
    return this.campaignsService.getRegistrationsByPickupCenter(req.user.id);
  }

  @Post('campaigns/verify-otp')
  async verifyCampaignOtp(@Body() body: { registration_id: number; otp: string }) {
    return this.campaignsService.verifyCampaignOtp(body);
  }

  @Post('campaigns/mark-pickup')
  async markPickup(@Body() body: { registration_id: number }) {
    return this.campaignsService.markPickup(body);
  }
}

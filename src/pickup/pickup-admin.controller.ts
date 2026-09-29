import { Controller, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, SUPER_ADMIN } from '../auth/roles.decorator';
import { PickupAdminService } from './pickup-admin.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SUPER_ADMIN)
@Controller('admin/pickup-points')
export class PickupAdminController {
  constructor(private readonly pickupAdminService: PickupAdminService) { }

  // ?status=pending|active|blocked (sans filtre : tous)
  @Get()
  list(@Query('status') status?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.pickupAdminService.list({ status, page, limit });
  }

  @Post(':id/resend-verification')
  resendVerification(@Param('id', ParseIntPipe) id: number) {
    return this.pickupAdminService.resendVerification(id);
  }

  @Patch(':id/approve')
  approve(@Param('id', ParseIntPipe) id: number) {
    return this.pickupAdminService.approve(id);
  }
}

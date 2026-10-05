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
  // + search, verified (1/0), located (1/0), sort
  @Get()
  list(@Query() q: any) {
    return this.pickupAdminService.list({ status: q.status, page: q.page, limit: q.limit, search: q.search, verified: q.verified, located: q.located, sort: q.sort });
  }

  @Get('facets')
  facets() {
    return this.pickupAdminService.facets();
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

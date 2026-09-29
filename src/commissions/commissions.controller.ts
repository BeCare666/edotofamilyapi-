import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, SUPER_ADMIN } from '../auth/roles.decorator';
import { CommissionsService } from './commissions.service';

// Réglage des commissions des points de retrait : super_admin uniquement
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SUPER_ADMIN)
@Controller('admin/commissions')
export class CommissionsController {
  constructor(private readonly commissions: CommissionsService) { }

  @Get()
  overview(@Query('q') q?: string) {
    return this.commissions.overview(q);
  }

  // :type = orders (pourcentage) | kits (montant par kit) ; body { value, scope: 'all' | 'selected', pickup_point_ids }
  @Put(':type')
  apply(@Param('type') type: string, @Body() body: any) {
    return this.commissions.apply(type as any, body);
  }
}

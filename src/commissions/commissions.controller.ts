import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, SUPER_ADMIN } from '../auth/roles.decorator';
import { CommissionsService } from './commissions.service';
import { ApplyCommissionDto } from './dto/apply-commission.dto';
import { CreatePayoutDto } from './payouts';

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

  // Versements aux points de retrait (B7) ; body { pickup_point_id, amount, method, reference?, note?, paid_at? }
  @Post('payouts')
  addPayout(@Req() req: any, @Body() body: CreatePayoutDto) {
    return this.commissions.addPayout(body, Number(req.user?.id));
  }

  @Get('payouts/:pointId')
  payouts(@Param('pointId') pointId: string) {
    return this.commissions.payouts(Number(pointId));
  }

  // :type = orders (pourcentage) | kits (montant par kit) ; body { value, scope: 'all' | 'selected', pickup_point_ids }
  @Put(':type')
  apply(@Param('type') type: string, @Body() body: ApplyCommissionDto) {
    return this.commissions.apply(type as any, body);
  }
}

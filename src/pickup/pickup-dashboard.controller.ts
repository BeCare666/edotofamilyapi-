import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { ActivePickupGuard } from '../auth/active-pickup.guard';
import { Roles, SUPER_PICKUPPOINT } from '../auth/roles.decorator';
import { PickupDashboardService } from './pickup-dashboard.service';

// Dashboard du point de retrait : l'identifiant du point vient toujours du jeton, jamais de la requête
@UseGuards(JwtAuthGuard, RolesGuard, ActivePickupGuard)
@Roles(SUPER_PICKUPPOINT)
@Controller('pickup/dashboard')
export class PickupDashboardController {
  constructor(private readonly dashboard: PickupDashboardService) { }

  // ?period=day|month|year&date=AAAA-MM-JJ | AAAA-MM | AAAA
  @Get('summary')
  summary(@Req() req: any, @Query('period') period?: string, @Query('date') date?: string) {
    return this.dashboard.summary(Number(req.user.id), period, date);
  }

  // ?period&date&type=order|kit&q
  @Get('history')
  history(@Req() req: any, @Query() query: any) {
    return this.dashboard.history(Number(req.user.id), query);
  }

  // ?status=pending|withdrawn|all&q&page&limit
  @Get('orders')
  orders(@Req() req: any, @Query() query: any) {
    return this.dashboard.orders(Number(req.user.id), query);
  }

  // ?status=pending|withdrawn|all&q
  @Get('kits')
  kits(@Req() req: any, @Query() query: any) {
    return this.dashboard.kits(Number(req.user.id), query);
  }

  @Get('notifications')
  notifications(@Req() req: any) {
    return this.dashboard.notifications(Number(req.user.id));
  }
}

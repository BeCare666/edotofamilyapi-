import { Body, Controller, Get, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsOptional, ValidateNested } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';
import { PickupOpeningService } from './pickup-opening.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { ActivePickupGuard } from '../auth/active-pickup.guard';
import { Roles, SUPER_PICKUPPOINT } from '../auth/roles.decorator';
import { PickupDashboardService } from './pickup-dashboard.service';
import { DatabaseService } from '../database/database.services';
import { pointMoney } from '../commissions/payouts';

// Jours d'ouverture (12/11/2026, rapports/PLAN_TOURNEES_RETRAIT.md, 1.8) : contrôles dans pickup-rounds.ts (parseOpeningRule)
export class OpeningDaysInput {
  @IsOptional() @IsScalar() mon?: boolean;
  @IsOptional() @IsScalar() tue?: boolean;
  @IsOptional() @IsScalar() wed?: boolean;
  @IsOptional() @IsScalar() thu?: boolean;
  @IsOptional() @IsScalar() fri?: boolean;
  @IsOptional() @IsScalar() sat?: boolean;
  @IsOptional() @IsScalar() sun?: boolean;
}
export class ClosureInput {
  @IsOptional() @IsScalar() from?: string;
  @IsOptional() @IsScalar() to?: string;
}
@StrictDto()
export class OpeningRuleDto {
  @IsOptional() @ValidateNested() @Type(() => OpeningDaysInput) days?: OpeningDaysInput;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ClosureInput) closures?: ClosureInput[];
}

// Dashboard du point de retrait : l'identifiant du point vient toujours du jeton, jamais de la requête
@UseGuards(JwtAuthGuard, RolesGuard, ActivePickupGuard)
@Roles(SUPER_PICKUPPOINT)
@Controller('pickup/dashboard')
export class PickupDashboardController {
  constructor(
    private readonly dashboard: PickupDashboardService,
    private readonly db: DatabaseService,
    private readonly opening: PickupOpeningService,
  ) { }

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

  // Argent (B7) : commissions gagnées, versements reçus, reste à verser
  @Get('payouts')
  payouts(@Req() req: any) {
    return pointMoney(this.db.getPool(), Number(req.user.id));
  }

  // Jours d'ouverture et congés du point (D8) ; refus si des colis sont attendus ces jours-là (D11)
  @Get('opening')
  getOpening(@Req() req: any) {
    return this.opening.get(Number(req.user.id));
  }

  @Put('opening')
  saveOpening(@Req() req: any, @Body() body: OpeningRuleDto) {
    return this.opening.save(Number(req.user.id), body);
  }

  @Get('notifications')
  notifications(@Req() req: any) {
    return this.dashboard.notifications(Number(req.user.id));
  }
}

import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PickupOpeningService } from './pickup-opening.service';

// Tournées (12/11/2026, rapports/PLAN_TOURNEES_RETRAIT.md, 1.9) : heure prévue affichée sous chaque point au moment du choix (D9).
// Aucune donnée personnelle : seulement la prochaine tournée de points de retrait validés.
@Controller('pickup-rounds')
export class PickupRoundsController {
  constructor(private readonly opening: PickupOpeningService) {}

  // ?points=12,15,18 (au plus 50)
  @Public()
  @Get('next')
  next(@Query('points') points?: string) {
    return this.opening.nextForPoints(points);
  }
}

// pickup.controller.ts
import { Controller, Get, Param } from '@nestjs/common';
import { PickupService } from './pickup.service';
import { Public } from '../auth/public.decorator';

@Controller('pickup')
export class PickupController {
    constructor(private pickupService: PickupService) { }

    @Public()
    @Get(':id') // récupérer un point de retrait spécifique
    getPickup(@Param('id') id: string) {
        return this.pickupService.getPickupPoint(Number(id));
    }

    @Public()
    @Get() // récupérer tous les points de retrait
    getAllPickupPoints() {
        return this.pickupService.getAllPickupPoints();
    }
}
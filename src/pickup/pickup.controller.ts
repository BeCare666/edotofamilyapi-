// pickup.controller.ts
import { Controller, Get, Param } from '@nestjs/common';
import { PickupService } from './pickup.service';

@Controller('pickup')
export class PickupController {
    constructor(private pickupService: PickupService) { }

    @Get(':id') // récupérer un point de retrait spécifique
    getPickup(@Param('id') id: string) {
        return this.pickupService.getPickupPoint(Number(id));
    }

    @Get() // récupérer tous les points de retrait
    getAllPickupPoints() {
        return this.pickupService.getAllPickupPoints();
    }
}
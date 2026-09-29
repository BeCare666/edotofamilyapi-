import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, SUPER_ADMIN } from '../auth/roles.decorator';
import { DeliveryService } from './delivery.service';

// Public : prix de la livraison affiché avant la commande (aucune donnée personnelle).
@Controller('delivery')
export class DeliveryController {
  constructor(private readonly deliveryService: DeliveryService) { }

  @Get('quote')
  quote(@Query('lat') lat: string, @Query('lng') lng: string) {
    return this.deliveryService.quote(lat, lng);
  }
}

// Public : page du zem. Protégée par le lien (secret), l'appareil qui l'a ouvert en premier et le PIN.
@Controller('courier-links')
export class CourierLinksController {
  constructor(private readonly deliveryService: DeliveryService) { }

  @Post(':token/open')
  open(@Param('token') token: string, @Body() body: any) {
    return this.deliveryService.courierOpen(token, body?.device_id);
  }

  @Post(':token/unlock')
  unlock(@Param('token') token: string, @Body() body: any) {
    return this.deliveryService.courierUnlock(token, body);
  }

  @Post(':token/deliver')
  deliver(@Param('token') token: string, @Body() body: any) {
    return this.deliveryService.courierDeliver(token, body);
  }
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SUPER_ADMIN)
@Controller('admin/delivery')
export class DeliveryAdminController {
  constructor(private readonly deliveryService: DeliveryService) { }

  @Get('settings')
  getSettings() {
    return this.deliveryService.getSettings();
  }

  @Put('settings')
  updateSettings(@Body() body: any) {
    return this.deliveryService.updateSettings(body);
  }

  // ?status=to_assign|in_progress|delivered (sans filtre : toutes)
  @Get('orders')
  list(@Query('status') status?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.deliveryService.adminList({ status, page, limit });
  }

  @Post('orders/:orderId/assign')
  assign(@Param('orderId', ParseIntPipe) orderId: number, @Body() body: any) {
    return this.deliveryService.assign(orderId, body);
  }

  @Post('orders/:orderId/deactivate')
  deactivate(@Param('orderId', ParseIntPipe) orderId: number) {
    return this.deliveryService.deactivate(orderId);
  }

  @Post('orders/:orderId/unblock')
  unblock(@Param('orderId', ParseIntPipe) orderId: number) {
    return this.deliveryService.unblock(orderId);
  }
}

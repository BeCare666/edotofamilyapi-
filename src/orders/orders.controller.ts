import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Headers,
  Req,
  BadRequestException,
  ForbiddenException,
  Patch,
  UseGuards,
} from '@nestjs/common';

import { CreateOrderStatusDto } from './dto/create-order-status.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { GetOrderFilesDto, OrderFilesPaginator } from './dto/get-downloads.dto';
import { GetOrderStatusesDto } from './dto/get-order-statuses.dto';
import { GetOrdersDto, OrderPaginator } from './dto/get-orders.dto';
import { OrderPaymentDto } from './dto/order-payment.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { CheckoutVerificationDto } from './dto/verify-checkout.dto';
import { Order } from './entities/order.entity';
import { OrdersService } from './orders.service';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { ActivePickupGuard } from '../auth/active-pickup.guard';
import { Roles, SUPER_ADMIN, SUPER_PICKUPPOINT } from '../auth/roles.decorator';
@UseGuards(JwtAuthGuard, RolesGuard, ActivePickupGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  async create(
    @Body() createOrderDto: CreateOrderDto,
    @Headers('authorization') token: string,
    @Req() req: any,
  ): Promise<Order> {
    return this.ordersService.create(createOrderDto, token, req.user);
  }

  // ---------------------- STATS PICKUP POINT ----------------------
@Get('stats')
async getPickupStats(
  @Query('pickup_point_id', ParseIntPipe) pickupPointId: number,
  @Req() req,
) {
  if (!req.user) {
    throw new BadRequestException();
  }

if (!Array.isArray(req.user.permissions) || !req.user.permissions.includes('super_pickuppoint')) {
  throw new ForbiddenException('Not super_pickuppoint');
}

  // 🚨 CLÉ : compare req.user?.userId !
  if (Number(req.user?.id) !== Number(pickupPointId)) {
    throw new ForbiddenException('Pickup point mismatch');
  }

  return this.ordersService.getPickupStats(pickupPointId);
}




  // ---------------------- ARCHIVE ORDER ----------------------
  @Roles(SUPER_ADMIN, SUPER_PICKUPPOINT)
  @Patch(':id/archive')
  async archiveOrder(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    if (!req.user) throw new BadRequestException('Utilisateur non authentifié');
    return this.ordersService.archiveOrder(id, req.user);
  }

  // ---------------------- UNARCHIVE ORDER ----------------------
  @Roles(SUPER_ADMIN, SUPER_PICKUPPOINT)
  @Patch(':id/unarchive')
  async unarchiveOrder(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
  ) {
    if (!req.user) throw new BadRequestException('Utilisateur non authentifié');
    return this.ordersService.unarchiveOrder(id, req.user);
  }

  // ---------------------- NEW ORDERS ----------------------
  @Roles(SUPER_ADMIN, SUPER_PICKUPPOINT)
  @Get('new')
  async getNewOrders(@Req() req: any) {
    if (!req.user) throw new BadRequestException('Utilisateur non authentifié');
    return this.ordersService.getNewOrders(req.user);
  }

  // ---------------------- VERIFY OTP ----------------------
  @Roles(SUPER_PICKUPPOINT)
  @Post('verify-otp')
  async verifyOtp(@Body() dto: VerifyOtpDto, @Req() req: any) {
    if (!req.user) throw new BadRequestException('Utilisateur non authentifié');

    return this.ordersService.verifyOtp(dto, {
      id: req.user?.id,
      permissions: req.user.permissions,
    });
  }

  // ---------------------- REGENERATE OTP (client) ----------------------
  @Post(':id/regenerate-otp')
  regenerateOtp(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.ordersService.regenerateOtp(id, req.user);
  }

  // ---------------------- LIST ORDERS ----------------------
  @Get()
  async getOrders(@Query() query: GetOrdersDto, @Req() req) {
    return this.ordersService.getOrders(query, req.user);
  }

  // Compteurs réels des filtres de la liste (même périmètre que la liste ; avant « :id »)
  @Get('facets')
  async getOrderFacets(@Query() query: GetOrdersDto, @Req() req) {
    return this.ordersService.getOrderFacets(query, req.user);
  }

  /**
   * OLD BLOCK — maintenant proprement commenté
   *
   * @UseGuards(JwtAuthGuard)
   * @Get()
   * async getOrders(@Query() query: GetOrdersDto, @Req() req) {
   *   const user = req.user;
   *   if (query.pickup_point_id) {
   *     if (user.role !== "super_pickuppoint")
   *       throw new ForbiddenException("Accès interdit");
   *
   *     if (user.id !== Number(query.pickup_point_id))
   *       throw new ForbiddenException("Vous n'avez pas accès à ces commandes");
   *   }
   *   return this.ordersService.getOrders(query);
   * }
   */

  // ---------------------- TRACKING NUMBER FIRST ----------------------
  @Get('tracking-number/:tracking_id')
  getOrderByTrackingNumber(@Param('tracking_id') tracking_id: string, @Req() req: any) {
    return this.ordersService.getOrderForUser(tracking_id, req.user);
  }

  // ---------------------- ORDER BY ID ----------------------
  @Get(':id')
  getOrderById(@Param('id') id: string, @Req() req: any) {
    const parsedId = Number(id);
    return this.ordersService.getOrderForUser(!isNaN(parsedId) ? parsedId : id, req.user);
  }

  // ---------------------- UPDATE ORDER ----------------------
  @Put(':id')
  update(@Param('id') id: string, @Body() updateOrderDto: UpdateOrderDto, @Req() req: any) {
    return this.ordersService.updateForUser(+id, updateOrderDto as any, req.user);
  }

  // ---------------------- DELETE ORDER ----------------------
  @Roles(SUPER_ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.ordersService.remove(+id);
  }

  // ---------------------- VERIFY CHECKOUT ----------------------
  @Post('checkout/verify')
  verifyCheckout(@Query() query: CheckoutVerificationDto) {
    return this.ordersService.verifyCheckout(query);
  }

  // ---------------------- PAYMENT ----------------------
  @Post('payment')
  @HttpCode(200)
  async submitPayment(
    @Body() orderPaymentDto: OrderPaymentDto,
  ): Promise<void> {
    const { tracking_number } = orderPaymentDto;
    const order: Order = await this.ordersService.getOrderByIdOrTrackingNumber(
      tracking_number,
    );

    switch (order.payment_gateway.toString().toLowerCase()) {
      case 'stripe':
        break;
      case 'paypal':
        break;
      default:
        break;
    }

    this.ordersService.processChildrenOrder(order);
  }
}

// ====================================================================
//                            ORDER STATUS
// ====================================================================
@Controller('order-status')
export class OrderStatusController {
  constructor(private readonly ordersService: OrdersService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(SUPER_ADMIN)
  @Post()
  create(@Body() createOrderStatusDto: CreateOrderStatusDto) {
    return this.ordersService.createOrderStatus(createOrderStatusDto);
  }

  @Get()
  findAll(@Query() query: GetOrderStatusesDto) {
    return this.ordersService.getOrderStatuses(query);
  }

  @Get(':param')
  findOne(@Param('param') param: string, @Query('language') language: string) {
    return this.ordersService.getOrderStatus(param, language);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(SUPER_ADMIN)
  @Put(':id')
  update(@Param('id') id: string, @Body() updateOrderDto: UpdateOrderDto, @Req() req: any) {
    return this.ordersService.updateForUser(+id, updateOrderDto as any, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(SUPER_ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.ordersService.remove(+id);
  }
}

// ====================================================================
//                            ORDER FILES
// ====================================================================
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SUPER_ADMIN)
@Controller('downloads')
export class OrderFilesController {
  constructor(private ordersService: OrdersService) {}

  @Get()
  async getOrderFileItems(
    @Query() query: GetOrderFilesDto,
  ): Promise<OrderFilesPaginator> {
    return this.ordersService.getOrderFileItems(query);
  }

  @Post('digital-file')
  async getDigitalFileDownloadUrl(
    @Body('digital_file_id', ParseIntPipe) digitalFileId: number,
  ) {
    return this.ordersService.getDigitalFileDownloadUrl(digitalFileId);
  }
}

// ====================================================================
//                           EXPORT ORDER URL
// ====================================================================
@Controller('export-order-url')
export class OrderExportController {
  constructor(private ordersService: OrdersService) {}

  @Get()
  async orderExport(@Query('shop_id') shop_id: string) {
    return this.ordersService.exportOrder(shop_id);
  }
}

// ====================================================================
//                          DOWNLOAD INVOICE URL
// ====================================================================
@Controller('download-invoice-url')
export class DownloadInvoiceController {
  constructor(private ordersService: OrdersService) {}

  @Post()
  async downloadInvoiceUrl(@Body('shop_id') shop_id: string) {
    return this.ordersService.downloadInvoiceUrl(shop_id);
  }
}

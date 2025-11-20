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
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  async create(
    @Body() createOrderDto: CreateOrderDto,
    @Headers('authorization') token: string,
  ): Promise<Order> {
    return this.ordersService.create(createOrderDto, token);
  }

  // ---------------------- STATS PICKUP POINT ----------------------
@Get('stats')
async getPickupStats(
  @Query('pickup_point_id', ParseIntPipe) pickupPointId: number,
  @Req() req,
) {
  console.log("📥 Incoming request stats:");
  console.log("req.user =", req.user);
  console.log("pickup_point_id =", pickupPointId);

  if (!req.user) {
    console.log("❌ NO USER IN REQUEST");
    throw new BadRequestException();
  }

if (!Array.isArray(req.user.permissions) || !req.user.permissions.includes('super_pickuppoint')) {
  console.log("❌ WRONG PERMISSIONS:", req.user.permissions);
  throw new ForbiddenException('Not super_pickuppoint');
}

  // 🚨 CLÉ : compare req.user?.userId !
  if (Number(req.user?.id) !== Number(pickupPointId)) {
    console.log("❌ USER-ID ≠ PICKUP-ID:", req.user?.id, pickupPointId);
    throw new ForbiddenException('Pickup point mismatch');
  }

  console.log("✅ ACCESS GRANTED");
  return this.ordersService.getPickupStats(pickupPointId);
}




  // ---------------------- ARCHIVE ORDER ----------------------
  @Patch(':id/archive')
  async archiveOrder(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    if (!req.user) throw new BadRequestException('Utilisateur non authentifié');
    return this.ordersService.archiveOrder(id, req.user);
  }

  // ---------------------- UNARCHIVE ORDER ----------------------
  @Patch(':id/unarchive')
  async unarchiveOrder(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
  ) {
    if (!req.user) throw new BadRequestException('Utilisateur non authentifié');
    return this.ordersService.unarchiveOrder(id);
  }

  // ---------------------- NEW ORDERS ----------------------
  @Get('new')
  async getNewOrders(@Req() req: any) {
    if (!req.user) throw new BadRequestException('Utilisateur non authentifié');
    return this.ordersService.getNewOrders(req.user);
  }

  // ---------------------- VERIFY OTP ----------------------
  @Post('verify-otp')
  async verifyOtp(@Body() dto: VerifyOtpDto, @Req() req: any) {
    if (!req.user) throw new BadRequestException('Utilisateur non authentifié');

    return this.ordersService.verifyOtp(dto, {
      id: req.user?.id,
      permissions: req.user.permissions,
    });
  }

  // ---------------------- LIST ORDERS ----------------------
  @Get()
  async getOrders(@Query() query: GetOrdersDto, @Req() req) {
    return this.ordersService.getOrders(query, req.user);
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
  getOrderByTrackingNumber(@Param('tracking_id') tracking_id: string) {
    return this.ordersService.getOrderByIdOrTrackingNumber(tracking_id);
  }

  // ---------------------- ORDER BY ID ----------------------
  @Get(':id')
  getOrderById(@Param('id') id: string) {
    const parsedId = Number(id);
    if (!isNaN(parsedId)) {
      return this.ordersService.getOrderByIdOrTrackingNumber(parsedId);
    }
    return this.ordersService.getOrderByIdOrTrackingNumber(id);
  }

  // ---------------------- UPDATE ORDER ----------------------
  @Put(':id')
  update(@Param('id') id: string, @Body() updateOrderDto: UpdateOrderDto) {
    return this.ordersService.update(+id, updateOrderDto);
  }

  // ---------------------- DELETE ORDER ----------------------
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

  @Put(':id')
  update(@Param('id') id: string, @Body() updateOrderDto: UpdateOrderDto) {
    return this.ordersService.update(+id, updateOrderDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.ordersService.remove(+id);
  }
}

// ====================================================================
//                            ORDER FILES
// ====================================================================
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

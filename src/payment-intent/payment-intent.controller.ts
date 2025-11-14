import { Controller, Post, Body, UseGuards, Res } from '@nestjs/common';
import { PaymentIntentService } from './payment-intent.service';
import { CreatePaymentIntentDto } from './dto/payment-intent.dto';
import { ConfirmPaymentDto } from './dto/confirm-payment.tdo';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';


@Controller('payments')
export class PaymentIntentController {
  constructor(private readonly PaymentIntentService: PaymentIntentService) { }

  @UseGuards(JwtAuthGuard)
  @Post('create-intent')
  async createIntent(@Body() dto: CreatePaymentIntentDto) {
    // Retourne le payment intent existant ou le nouvel intent
    return this.PaymentIntentService.createPaymentIntent(
      dto.orderId,
      dto.paymentGateway
    );
  }
  // Route : POST /payments/feexpay/complete
  @Post('feexpay/complete')
  async completeFeexPay(
    @Body() body: { transaction_id: string; custom_id: string }
  ) {
    return this.PaymentIntentService.completeFeexPayPayment(body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('confirm')
  async confirmPayment(@Body() dto: ConfirmPaymentDto) {
    const { paymentIntentId, tx_ref, transaction_id } = dto;

    if (!paymentIntentId || !tx_ref || !transaction_id) {
      throw new Error('Missing paymentIntentId, tx_ref or transaction_id');
    }

    return this.PaymentIntentService.confirmPayment(paymentIntentId, tx_ref, transaction_id);
  }
  @Post('webhook')
  async flutterwaveWebhook(@Body() body: any) {
    return this.PaymentIntentService.handleFlutterwaveWebhook(body);
  }

}

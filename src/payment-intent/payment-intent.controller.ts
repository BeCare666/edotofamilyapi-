import { Controller, Post, Body, UseGuards, Res, Req } from '@nestjs/common';
import { PaymentIntentService } from './payment-intent.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';


@Controller('payments')
export class PaymentIntentController {
  constructor(private readonly PaymentIntentService: PaymentIntentService) { }

  // Route : POST /payments/feexpay/complete
  @UseGuards(JwtAuthGuard)
  @Post('feexpay/complete')
  async completeFeexPay(
    @Body() body: { transaction_id: string; custom_id: string; feexpay_response?: any },
    @Req() req: any,
  ) {
    return this.PaymentIntentService.completeFeexPayForUser(body, req.user);
  }


}

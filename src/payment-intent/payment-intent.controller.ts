import { Controller, Post, Body, UseGuards, Res, Req } from '@nestjs/common';
import { PaymentIntentService } from './payment-intent.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompleteFeexPayDto } from './dto/complete-feexpay.dto';


@Controller('payments')
export class PaymentIntentController {
  constructor(private readonly PaymentIntentService: PaymentIntentService) { }

  // Route : POST /payments/feexpay/complete
  @UseGuards(JwtAuthGuard)
  @Post('feexpay/complete')
  async completeFeexPay(
    @Body() body: CompleteFeexPayDto,
    @Req() req: any,
  ) {
    return this.PaymentIntentService.completeFeexPayForUser(body, req.user);
  }


}

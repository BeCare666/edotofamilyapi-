import { Controller, Headers, Post, Req, Res, HttpStatus } from '@nestjs/common';
import { WebHookService } from './webhook.service';
import { PaymentMethodService } from 'src/payment-method/payment-method.service';
import { Request, Response } from 'express';
import * as crypto from 'crypto';

@Controller('webhook')
export class WebHookController {
  constructor(
    private readonly webhookService: WebHookService,
    private readonly paymentMethodService: PaymentMethodService,
  ) { }

  @Post('flutterwave')
  async handleFlutterwaveWebhook(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('verif-hash') signature: string,
  ) {
    const secretHash = process.env.FLUTTERWAVE_SECRET_HASH;

    if (!secretHash || !signature) {
      return res.status(HttpStatus.FORBIDDEN).json({ message: 'Invalid webhook headers' });
    }

    // Calcul du hash pour vérifier la signature
    const hash = crypto
      .createHmac('sha256', secretHash)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash !== signature) {
      return res.status(HttpStatus.FORBIDDEN).json({ message: 'Invalid webhook signature' });
    }

    const payload = req.body;

    // Vérifie l'événement webhook
    if (payload?.event === 'charge.completed') {
      const paymentData = payload.data;

      // Appel du service de validation paiement
      await this.paymentMethodService.validatePayment({
        userId: paymentData.customer?.id,
        amount: paymentData.amount,
        status: paymentData.status,
        reference: paymentData.tx_ref || paymentData.flw_ref,
      });
    }

    return res.status(HttpStatus.OK).json({ message: 'Webhook received' });
  }
}

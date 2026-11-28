import { Body, Controller, Headers, HttpCode, Post, Req, type RawBodyRequest } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../access/access.decorators';
import { ChannelHubService } from './channel-hub.service';

/**
 * Webhook do iFood (simulado até termos a conta de parceiro). Sem login: o restaurante é achado pelo
 * código da loja (merchantId) e o aviso é autenticado pela assinatura x-ifood-signature (HMAC do corpo).
 */
@Public()
@SkipThrottle()
@Controller('public/webhooks')
export class IfoodWebhookController {
  constructor(private readonly hub: ChannelHubService) {}

  @Post('ifood')
  @HttpCode(202)
  receive(@Req() req: RawBodyRequest<Request>, @Body() body: unknown, @Headers('x-ifood-signature') signature: string | undefined) {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(body ?? {});
    return this.hub.receiveIfood(body, raw, signature);
  }
}

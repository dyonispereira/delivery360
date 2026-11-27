import { Body, Controller, Get, Headers, HttpCode, Ip, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Public } from '../access/access.decorators';
import { CreateOrderDto, PayCardDto, QuoteOrderDto, RateOrderDto, TipDto } from '../cardapio/cardapio.dto';
import { OrdersService } from '../cardapio/orders.service';

/** Rotas abertas da loja online (sem login). */
@Public()
@Controller('public')
export class PublicController {
  constructor(private readonly orders: OrdersService) {}

  @Get('stores/:slug')
  store(@Param('slug') slug: string) {
    return this.orders.getPublicMenu(slug);
  }

  /** Limite por IP para evitar pedidos em massa. */
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 1000 : 10, ttl: 60_000 } })
  @Post('stores/:slug/orders')
  createOrder(@Param('slug') slug: string, @Body() dto: CreateOrderDto) {
    return this.orders.createPublicOrder(slug, dto);
  }

  /** Prévia da conta com cupom. Limite por IP para ninguém testar códigos em massa. */
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 1000 : 30, ttl: 60_000 } })
  @Post('stores/:slug/quote')
  @HttpCode(200)
  quote(@Param('slug') slug: string, @Body() dto: QuoteOrderDto) {
    return this.orders.quotePublicOrder(slug, dto);
  }

  @Get('orders/:code')
  track(@Param('code') code: string) {
    return this.orders.getTracking(code);
  }

  /**
   * Checkout transparente do cartão. Limite baixo por IP para ninguém testar cartões em massa.
   * O IP vai para o antifraude do gateway (com TRUST_PROXY, é o IP real do cliente).
   */
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 1000 : 6, ttl: 60_000 } })
  @Post('orders/:code/pay-card')
  @HttpCode(200)
  payCard(@Param('code') code: string, @Body() dto: PayCardDto, @Ip() ip: string) {
    return this.orders.payWithCard(code, dto, (ip ?? '').replace(/^::ffff:/, '') || '127.0.0.1');
  }

  /** Só com PAYMENTS_FAKE_ENABLED=true (desenvolvimento e testes). */
  @Post('orders/:code/simulate-payment')
  @HttpCode(200)
  simulate(@Param('code') code: string) {
    return this.orders.simulatePayment(code);
  }

  /** Avaliação de 1 a 5 estrelas (restaurante e entrega), uma vez por pedido. */
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 1000 : 10, ttl: 60_000 } })
  @Post('orders/:code/rating')
  @HttpCode(200)
  rate(@Param('code') code: string, @Body() dto: RateOrderDto) {
    return this.orders.rate(code, dto);
  }

  /** Gera o PIX da gorjeta para o motoboy. */
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 1000 : 10, ttl: 60_000 } })
  @Post('orders/:code/tip')
  @HttpCode(200)
  tip(@Param('code') code: string, @Body() dto: TipDto) {
    return this.orders.createTip(code, dto);
  }

  @Post('orders/:code/tip/simulate-payment')
  @HttpCode(200)
  simulateTip(@Param('code') code: string) {
    return this.orders.simulateTip(code);
  }

  /** Aviso de pagamento do Asaas (conta do restaurante). Autenticado pelo header asaas-access-token. */
  @SkipThrottle()
  @Post('webhooks/asaas/:tenantId')
  @HttpCode(200)
  asaasWebhook(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Headers('asaas-access-token') token: string | undefined,
    @Body() body: { event?: string; payment?: { id?: string; value?: number; netValue?: number } },
  ) {
    return this.orders.asaasWebhook(tenantId, token, body);
  }
}

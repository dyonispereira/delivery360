import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Ip, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Public } from '../access/access.decorators';
import { CreateOrderDto, PayCardDto, QuoteOrderDto, RateOrderDto, TipDto, TotemOrderDto } from '../cardapio/cardapio.dto';
import { TotemService } from '../cardapio/totem.service';
import { OrdersService } from '../cardapio/orders.service';
import { LoyaltyService } from '../cardapio/loyalty.service';
import { normalizePhone } from '../cardapio/order-pricing';

/** Rotas abertas da loja online (sem login). */
@Public()
@Controller('public')
export class PublicController {
  constructor(
    private readonly orders: OrdersService,
    private readonly loyalty: LoyaltyService,
    private readonly totem: TotemService,
  ) {}

  /** Totem de autoatendimento: nome, se está ligado e os modos de consumo. */
  @Get('stores/:slug/totem/:id')
  totemInfo(@Param('slug') slug: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.totem.publicTotem(slug, id);
  }

  /** Pedido do totem (aguarda pagamento no caixa). Repetir com a mesma chave devolve o mesmo pedido. */
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 1000 : 30, ttl: 60_000 } })
  @Post('stores/:slug/totem/:id/orders')
  totemOrder(@Param('slug') slug: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: TotemOrderDto) {
    return this.totem.createOrder(slug, id, dto);
  }

  @Get('stores/:slug')
  store(@Param('slug') slug: string) {
    return this.orders.getPublicMenu(slug);
  }

  /**
   * Fidelidade da loja: regras, prêmios e níveis. Com o telefone, o saldo e o nível do cliente
   * (sem nome nem dados pessoais). Limite por IP para ninguém varrer telefones.
   */
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 1000 : 20, ttl: 60_000 } })
  @Get('stores/:slug/fidelidade')
  async loyaltyInfo(@Param('slug') slug: string, @Query('telefone') phone?: string) {
    const store = await this.orders.findPublicStore(slug);
    const program = await this.loyalty.publicProgram(store.tenantId);
    if (!program || !phone) return { program, customer: null };
    const digits = normalizePhone(phone);
    if (!digits) throw new BadRequestException('Informe um telefone com DDD.');
    return { program, customer: await this.loyalty.customerStatus(store.tenantId, digits) };
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

import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../access/access.decorators';
import { CreateOrderDto } from '../cardapio/cardapio.dto';
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

  @Get('orders/:code')
  track(@Param('code') code: string) {
    return this.orders.getTracking(code);
  }

  /** Só com PAYMENTS_FAKE_ENABLED=true (desenvolvimento e testes). */
  @Post('orders/:code/simulate-payment')
  @HttpCode(200)
  simulate(@Param('code') code: string) {
    return this.orders.simulatePayment(code);
  }
}

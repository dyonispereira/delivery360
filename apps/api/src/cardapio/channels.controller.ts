import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseEnumPipe, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CurrentTenant, RequireModule, TenantRoles } from '../access/access.decorators';
import type { TenantContext } from '../access/access.types';
import { ChannelOrderDto, ChannelSettingDto, MARKETPLACE_CODES, type MarketplaceCode } from './cardapio.dto';
import { ChannelOrdersService } from './channel-orders.service';
import { ChannelHubService } from './channel-hub.service';

const CHANNEL = new ParseEnumPipe(Object.fromEntries(MARKETPLACE_CODES.map((c) => [c, c])), {
  exceptionFactory: () => new BadRequestException('Canal inválido.'),
});

/**
 * Canais de venda (iFood, 99Food, Keeta): configuração financeira de cada app e entrada de pedidos.
 * A entrada de pedidos recebe o formato único do sistema; os conectores de cada app usam o mesmo caminho.
 */
@RequireModule('cardapio')
@TenantRoles('OWNER', 'MANAGER')
@Controller('cardapio/canais')
export class ChannelsController {
  constructor(
    private readonly channels: ChannelOrdersService,
    private readonly hub: ChannelHubService,
  ) {}

  /** Eventos recebidos do iFood (o que chegou, se entrou e o erro, quando houver). */
  @Get('ifood/eventos')
  ifoodEvents(@CurrentTenant() t: TenantContext, @Query('status') status?: string) {
    return this.hub.listEvents(t.tenantId, status);
  }

  /** Tenta de novo um evento do iFood que deu erro (ex.: depois de cadastrar o código PDV que faltava). */
  @Post('ifood/eventos/:id/reprocessar')
  @HttpCode(200)
  reprocess(@CurrentTenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.hub.reprocess(t.tenantId, id);
  }

  @Get()
  list(@CurrentTenant() t: TenantContext) {
    return this.channels.listSettings(t.tenantId);
  }

  @Put(':channel')
  update(@CurrentTenant() t: TenantContext, @Param('channel', CHANNEL) channel: MarketplaceCode, @Body() dto: ChannelSettingDto) {
    return this.channels.updateSetting(t.tenantId, channel, dto);
  }

  /** Entrada de um pedido de app (formato único). Repetir o mesmo pedido não duplica. */
  @Post('pedidos')
  @HttpCode(200)
  importOrder(@CurrentTenant() t: TenantContext, @Body() dto: ChannelOrderDto) {
    return this.channels.importOrder(t.tenantId, dto);
  }

  /** Pedido de teste do app (só em desenvolvimento e no link de teste). */
  @Post(':channel/simular')
  @HttpCode(200)
  simulate(@CurrentTenant() t: TenantContext, @Param('channel', CHANNEL) channel: MarketplaceCode) {
    return this.channels.simulate(t.tenantId, channel);
  }
}

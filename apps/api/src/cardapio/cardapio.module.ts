import { Module } from '@nestjs/common';
import { PublicController } from '../public/public.controller';
import { CardapioManageController } from './cardapio.controller';
import { CatalogService } from './catalog.service';
import { OrdersService } from './orders.service';
import { ChannelsController } from './channels.controller';
import { ChannelOrdersService } from './channel-orders.service';
import { CouponsService } from './coupons.service';
import { CombosService } from './combos.service';

@Module({
  controllers: [CardapioManageController, ChannelsController, PublicController],
  providers: [CatalogService, OrdersService, ChannelOrdersService, CouponsService, CombosService],
  exports: [OrdersService],
})
export class CardapioModule {}

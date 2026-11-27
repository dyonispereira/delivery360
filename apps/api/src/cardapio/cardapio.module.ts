import { Module } from '@nestjs/common';
import { PublicController } from '../public/public.controller';
import { CardapioManageController } from './cardapio.controller';
import { CatalogService } from './catalog.service';
import { OrdersService } from './orders.service';
import { ChannelsController } from './channels.controller';
import { ChannelOrdersService } from './channel-orders.service';
import { CouponsService } from './coupons.service';
import { CombosService } from './combos.service';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';
import { SalaoController } from './salao.controller';
import { SalaoService } from './salao.service';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';

@Module({
  controllers: [CardapioManageController, ChannelsController, PublicController, CampaignsController, SalaoController, LoyaltyController],
  providers: [CatalogService, OrdersService, ChannelOrdersService, CouponsService, CombosService, CampaignsService, SalaoService, LoyaltyService],
  exports: [OrdersService],
})
export class CardapioModule {}

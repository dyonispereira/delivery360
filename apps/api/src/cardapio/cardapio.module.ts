import { Module } from '@nestjs/common';
import { PublicController } from '../public/public.controller';
import { CardapioManageController } from './cardapio.controller';
import { CatalogService } from './catalog.service';
import { OrdersService } from './orders.service';
import { ChannelsController } from './channels.controller';
import { ChannelOrdersService } from './channel-orders.service';
import { ChannelHubService } from './channel-hub.service';
import { IfoodCatalogService } from './ifood-catalog.service';
import { IfoodWebhookController } from './ifood-webhook.controller';
import { CouponsService } from './coupons.service';
import { CombosService } from './combos.service';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';
import { SalaoController } from './salao.controller';
import { SalaoService } from './salao.service';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';
import { PdvController } from './pdv.controller';
import { TotemService } from './totem.service';
import { PdvService } from './pdv.service';
import { FiscalService } from '../fiscal/fiscal.service';

@Module({
  controllers: [CardapioManageController, ChannelsController, IfoodWebhookController, PublicController, CampaignsController, SalaoController, LoyaltyController, PdvController],
  providers: [CatalogService, OrdersService, ChannelOrdersService, ChannelHubService, IfoodCatalogService, CouponsService, CombosService, CampaignsService, SalaoService, LoyaltyService, PdvService, FiscalService, TotemService],
  exports: [OrdersService],
})
export class CardapioModule {}

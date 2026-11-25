import { Module } from '@nestjs/common';
import { PublicController } from '../public/public.controller';
import { CardapioManageController } from './cardapio.controller';
import { CatalogService } from './catalog.service';
import { OrdersService } from './orders.service';

@Module({
  controllers: [CardapioManageController, PublicController],
  providers: [CatalogService, OrdersService],
  exports: [OrdersService],
})
export class CardapioModule {}

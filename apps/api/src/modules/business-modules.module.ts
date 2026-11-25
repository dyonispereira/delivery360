import { Module } from '@nestjs/common';
import { CardapioController, EntregasController, TrafegoController } from './modules.controllers';

@Module({ controllers: [CardapioController, EntregasController, TrafegoController] })
export class BusinessModulesModule {}

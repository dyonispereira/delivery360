import { Module } from '@nestjs/common';
import { CardapioController, EntregasController, GestaoController, TrafegoController } from './modules.controllers';

@Module({ controllers: [GestaoController, CardapioController, EntregasController, TrafegoController] })
export class BusinessModulesModule {}

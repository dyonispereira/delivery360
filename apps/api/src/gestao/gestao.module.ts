import { Module } from '@nestjs/common';
import { GestaoController } from './gestao.controller';
import { GestaoService } from './gestao.service';
import { GestaoSyncService } from './gestao-sync.service';

/** Módulo Gestão: plano de contas, contas a pagar e receber, lançamentos automáticos e DRE. */
@Module({
  controllers: [GestaoController],
  providers: [GestaoService, GestaoSyncService],
  exports: [GestaoSyncService],
})
export class GestaoModule {}

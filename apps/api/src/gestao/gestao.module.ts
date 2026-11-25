import { Module } from '@nestjs/common';
import { GestaoController } from './gestao.controller';
import { GestaoService } from './gestao.service';
import { GestaoSyncService } from './gestao-sync.service';
import { PessoasController } from './pessoas.controller';
import { PessoasService } from './pessoas.service';

/** Módulo Gestão: plano de contas, contas a pagar e receber, lançamentos automáticos, DRE e pessoas (folha). */
@Module({
  controllers: [GestaoController, PessoasController],
  providers: [GestaoService, GestaoSyncService, PessoasService],
  exports: [GestaoSyncService],
})
export class GestaoModule {}

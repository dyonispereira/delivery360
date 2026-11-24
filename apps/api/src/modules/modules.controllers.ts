import { Controller, Get } from '@nestjs/common';
import { MODULES } from '@delivery360/shared';
import { CurrentTenant, RequireModule } from '../access/access.decorators';
import type { TenantContext } from '../access/access.types';

/**
 * Pontos de entrada de cada módulo. Por enquanto só respondem "status";
 * as próximas sprints colocam as rotas reais aqui, já protegidas pela chave do módulo.
 */

@RequireModule('gestao')
@Controller('gestao')
export class GestaoController {
  @Get('status')
  status(@CurrentTenant() t: TenantContext) {
    return { module: MODULES.gestao.code, tenantId: t.tenantId, ok: true };
  }
}

@RequireModule('cardapio')
@Controller('cardapio')
export class CardapioController {
  @Get('status')
  status(@CurrentTenant() t: TenantContext) {
    return { module: MODULES.cardapio.code, tenantId: t.tenantId, ok: true };
  }
}

@RequireModule('entregas')
@Controller('entregas')
export class EntregasController {
  @Get('status')
  status(@CurrentTenant() t: TenantContext) {
    return { module: MODULES.entregas.code, tenantId: t.tenantId, ok: true };
  }
}

@RequireModule('trafego')
@Controller('trafego')
export class TrafegoController {
  @Get('status')
  status(@CurrentTenant() t: TenantContext) {
    return { module: MODULES.trafego.code, tenantId: t.tenantId, ok: true };
  }
}

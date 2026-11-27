import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentTenant, RequireModule, TenantRoles } from '../access/access.decorators';
import type { TenantContext } from '../access/access.types';
import { ClubLevelDto, LoyaltyAdjustDto, LoyaltyProgramDto, LoyaltyRewardDto } from './cardapio.dto';
import { LoyaltyService } from './loyalty.service';

const UUID = new ParseUUIDPipe();

/** Fidelidade: pontos, prêmios, clube de benefícios e Indique e Ganhe. Mudar regras: dono e gerente. */
@RequireModule('cardapio')
@Controller('cardapio/fidelidade')
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get()
  overview(@CurrentTenant() t: TenantContext) {
    return this.loyalty.overview(t.tenantId);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Put()
  save(@CurrentTenant() t: TenantContext, @Body() dto: LoyaltyProgramDto) {
    return this.loyalty.saveProgram(t.tenantId, dto);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Post('premios')
  createReward(@CurrentTenant() t: TenantContext, @Body() dto: LoyaltyRewardDto) {
    return this.loyalty.createReward(t.tenantId, dto);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Patch('premios/:id')
  updateReward(@CurrentTenant() t: TenantContext, @Param('id', UUID) id: string, @Body() dto: LoyaltyRewardDto) {
    return this.loyalty.updateReward(t.tenantId, id, dto);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Delete('premios/:id')
  deleteReward(@CurrentTenant() t: TenantContext, @Param('id', UUID) id: string) {
    return this.loyalty.deleteReward(t.tenantId, id);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Post('niveis')
  createLevel(@CurrentTenant() t: TenantContext, @Body() dto: ClubLevelDto) {
    return this.loyalty.createLevel(t.tenantId, dto);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Patch('niveis/:id')
  updateLevel(@CurrentTenant() t: TenantContext, @Param('id', UUID) id: string, @Body() dto: ClubLevelDto) {
    return this.loyalty.updateLevel(t.tenantId, id, dto);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Delete('niveis/:id')
  deleteLevel(@CurrentTenant() t: TenantContext, @Param('id', UUID) id: string) {
    return this.loyalty.deleteLevel(t.tenantId, id);
  }

  @Get('clientes')
  customers(@CurrentTenant() t: TenantContext, @Query('busca') search?: string) {
    return this.loyalty.customers(t.tenantId, search);
  }

  @Get('clientes/:id/extrato')
  history(@CurrentTenant() t: TenantContext, @Param('id', UUID) id: string) {
    return this.loyalty.history(t.tenantId, id);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Post('clientes/:id/ajuste')
  adjust(@CurrentTenant() t: TenantContext, @Param('id', UUID) id: string, @Body() dto: LoyaltyAdjustDto) {
    return this.loyalty.adjust(t.tenantId, id, dto);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Post, Put } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { CurrentTenant, CurrentUser, RequireModule, TenantRoles } from '../access/access.decorators';
import type { AuthUser, TenantContext } from '../access/access.types';
import { WhatsappService } from './whatsapp.service';

export class WhatsappNotifyDto {
  @IsBoolean() notifyEnabled: boolean;
}

/** WhatsApp da loja (QR Code) para avisar o cliente do status do pedido. */
@RequireModule('cardapio')
@Controller('cardapio/whatsapp')
export class WhatsappController {
  constructor(private readonly whatsapp: WhatsappService) {}

  @TenantRoles('OWNER', 'MANAGER')
  @Get()
  status(@CurrentTenant() t: TenantContext) {
    return this.whatsapp.status(t.tenantId);
  }

  /** Gera o QR Code (ou devolve "conectado" se já estiver). */
  @TenantRoles('OWNER', 'MANAGER')
  @Post('connect')
  @HttpCode(200)
  connect(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser) {
    return this.whatsapp.connect(t.tenantId, u.id);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Put()
  notify(@CurrentTenant() t: TenantContext, @Body() dto: WhatsappNotifyDto) {
    return this.whatsapp.setNotify(t.tenantId, dto.notifyEnabled);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Post('test')
  @HttpCode(200)
  test(@CurrentTenant() t: TenantContext) {
    return this.whatsapp.sendTest(t.tenantId);
  }

  @TenantRoles('OWNER')
  @Delete()
  disconnect(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser) {
    return this.whatsapp.disconnect(t.tenantId, u.id);
  }
}

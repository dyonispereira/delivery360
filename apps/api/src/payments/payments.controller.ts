import { Body, Controller, Delete, Get, Put } from '@nestjs/common';
import { IsBoolean, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { CurrentTenant, CurrentUser, RequireModule, TenantRoles } from '../access/access.decorators';
import type { AuthUser, TenantContext } from '../access/access.types';
import { PaymentAccountsService } from './payment-accounts.service';

export class ConnectAsaasDto {
  @IsString() @MinLength(20) @MaxLength(400) @Matches(/^\S+$/, { message: 'Cole a chave da API sem espaços.' }) apiKey: string;
  @IsBoolean() sandbox: boolean;
}

/** Conta de pagamento da loja. Só o dono conecta ou desconecta (o dinheiro é dele). */
@RequireModule('cardapio')
@Controller('cardapio/payments')
export class PaymentsController {
  constructor(private readonly accounts: PaymentAccountsService) {}

  @TenantRoles('OWNER', 'MANAGER')
  @Get('account')
  status(@CurrentTenant() t: TenantContext) {
    return this.accounts.status(t.tenantId);
  }

  @TenantRoles('OWNER')
  @Put('account/asaas')
  connect(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body() dto: ConnectAsaasDto) {
    return this.accounts.connect(t.tenantId, u.id, dto);
  }

  @TenantRoles('OWNER')
  @Delete('account')
  disconnect(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser) {
    return this.accounts.disconnect(t.tenantId, u.id);
  }
}

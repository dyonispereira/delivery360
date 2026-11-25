import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { EntryStatus, EntryType } from '@prisma/client';
import { MODULES } from '@delivery360/shared';
import { CurrentTenant, CurrentUser, RequireModule, TenantRoles } from '../access/access.decorators';
import type { AuthUser, TenantContext } from '../access/access.types';
import { AccountDto, EntryDto, PayDto, PayManyDto, PeriodQuery, UpdateAccountDto, UpdateEntryDto } from './gestao.dto';
import { GestaoService } from './gestao.service';

const UUID = new ParseUUIDPipe();
const TYPES: EntryType[] = ['RECEIVABLE', 'PAYABLE'];
const STATUSES = ['OPEN', 'PAID', 'CANCELLED', 'OVERDUE'] as const;

/** Financeiro é assunto do dono e do gerente: a equipe (STAFF) não vê. */
@RequireModule('gestao')
@TenantRoles('OWNER', 'MANAGER')
@Controller('gestao')
export class GestaoController {
  constructor(private readonly gestao: GestaoService) {}

  @Get('status')
  status(@CurrentTenant() t: TenantContext) {
    return { module: MODULES.gestao.code, tenantId: t.tenantId, ok: true };
  }

  @Get('summary')
  summary(@CurrentTenant() t: TenantContext) {
    return this.gestao.summary(t.tenantId);
  }

  @Get('dre')
  dre(@CurrentTenant() t: TenantContext, @Query() q: PeriodQuery) {
    return this.gestao.dre(t.tenantId, q.from, q.to);
  }

  @Get('accounts')
  accounts(@CurrentTenant() t: TenantContext) {
    return this.gestao.accounts(t.tenantId);
  }

  @Post('accounts')
  createAccount(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body() dto: AccountDto) {
    return this.gestao.createAccount(t.tenantId, u.id, dto);
  }

  @Patch('accounts/:id')
  updateAccount(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() dto: UpdateAccountDto) {
    return this.gestao.updateAccount(t.tenantId, u.id, id, dto);
  }

  @Get('entries')
  entries(
    @CurrentTenant() t: TenantContext,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('accountId') accountId?: string,
    @Query('search') search?: string,
  ) {
    const date = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);
    return this.gestao.entries(t.tenantId, {
      type: TYPES.includes(type as EntryType) ? (type as EntryType) : undefined,
      status: (STATUSES as readonly string[]).includes(status ?? '') ? (status as EntryStatus | 'OVERDUE') : undefined,
      from: date(from),
      to: date(to),
      accountId: accountId && /^[0-9a-f-]{36}$/i.test(accountId) ? accountId : undefined,
      search: search?.trim().slice(0, 80) || undefined,
    });
  }

  @Post('entries')
  create(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body() dto: EntryDto) {
    return this.gestao.createEntry(t.tenantId, u.id, dto);
  }

  @Patch('entries/:id')
  update(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() dto: UpdateEntryDto) {
    return this.gestao.updateEntry(t.tenantId, u.id, id, dto);
  }

  @Post('entries/:id/pay')
  @HttpCode(200)
  pay(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() dto: PayDto) {
    return this.gestao.pay(t.tenantId, u.id, [id], dto.paidAt);
  }

  @Post('entries/pay-many')
  @HttpCode(200)
  payMany(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body() dto: PayManyDto) {
    return this.gestao.pay(t.tenantId, u.id, [...new Set(dto.ids)], dto.paidAt);
  }

  @Post('entries/:id/reopen')
  @HttpCode(200)
  reopen(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.gestao.reopen(t.tenantId, u.id, id);
  }

  @Delete('entries/:id')
  cancel(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.gestao.cancel(t.tenantId, u.id, id);
  }
}

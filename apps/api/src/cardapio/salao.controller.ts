import { Body, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { CurrentTenant, CurrentUser, RequireModule, TenantRoles } from '../access/access.decorators';
import type { AuthUser, TenantContext } from '../access/access.types';
import { PrismaService } from '../prisma/prisma.service';
import { BulkTablesDto, CloseTabDto, ServiceFeeDto, TableDto, TableOrderDto, UpdateTableDto } from './cardapio.dto';
import { OrdersService } from './orders.service';
import { SalaoService } from './salao.service';

const UUID = new ParseUUIDPipe();

/**
 * Salão (garçom e caixa): qualquer pessoa do restaurante lança pedidos e fecha a conta da mesa.
 * Cadastrar mesas e mudar a taxa de serviço: dono e gerente.
 */
@RequireModule('cardapio')
@Controller('cardapio/salao')
export class SalaoController {
  constructor(
    private readonly salao: SalaoService,
    private readonly orders: OrdersService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('tables')
  tables(@CurrentTenant() t: TenantContext) {
    return this.salao.listTables(t.tenantId);
  }

  /** Todas as mesas, inclusive as desativadas (tela de cadastro). */
  @Get('tables/all')
  allTables(@CurrentTenant() t: TenantContext) {
    return this.salao.listTables(t.tenantId, true);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Post('tables')
  createTable(@CurrentTenant() t: TenantContext, @Body() dto: TableDto) {
    return this.salao.createTable(t.tenantId, dto);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Post('tables/bulk')
  createTables(@CurrentTenant() t: TenantContext, @Body() dto: BulkTablesDto) {
    return this.salao.createTables(t.tenantId, dto);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Patch('tables/:id')
  updateTable(@CurrentTenant() t: TenantContext, @Param('id', UUID) id: string, @Body() dto: UpdateTableDto) {
    return this.salao.updateTable(t.tenantId, id, dto);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Delete('tables/:id')
  deleteTable(@CurrentTenant() t: TenantContext, @Param('id', UUID) id: string) {
    return this.salao.deleteTable(t.tenantId, id);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Put('service-fee')
  serviceFee(@CurrentTenant() t: TenantContext, @Body() dto: ServiceFeeDto) {
    return this.salao.setServiceFee(t.tenantId, dto.serviceFeeBps);
  }

  /** Cardápio para o garçom: o mesmo da loja online (preços de hoje, adicionais, esgotados). */
  @Get('menu')
  async menu(@CurrentTenant() t: TenantContext) {
    const store = await this.prisma.store.findUnique({ where: { tenantId: t.tenantId }, select: { slug: true } });
    if (!store) throw new NotFoundException('Configure a loja em Cardápio e pedidos antes de usar o salão.');
    const menu = await this.orders.getPublicMenu(store.slug);
    return { categories: menu.categories, topProductIds: menu.topProductIds };
  }

  @Get('tables/:id/tab')
  tableTab(@CurrentTenant() t: TenantContext, @Param('id', UUID) id: string) {
    return this.salao.openTabOf(t.tenantId, id);
  }

  @Post('tables/:id/orders')
  addOrder(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() dto: TableOrderDto) {
    return this.salao.addOrder(t.tenantId, u.id, id, dto);
  }

  @Post('orders/:id/served')
  served(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.salao.markServed(t.tenantId, u.id, id);
  }

  @Get('tabs/closed')
  closed(@CurrentTenant() t: TenantContext) {
    return this.salao.closedToday(t.tenantId);
  }

  @Get('tabs/:id')
  tab(@CurrentTenant() t: TenantContext, @Param('id', UUID) id: string) {
    return this.salao.tabDetail(t.tenantId, id);
  }

  @Post('tabs/:id/close')
  close(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() dto: CloseTabDto) {
    return this.salao.closeTab(t.tenantId, u.id, id, dto);
  }
}

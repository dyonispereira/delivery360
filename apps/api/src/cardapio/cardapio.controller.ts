import { Body, Controller, Delete, Get, Param, ParseEnumPipe, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { CurrentTenant, CurrentUser, RequireModule, TenantRoles } from '../access/access.decorators';
import type { AuthUser, TenantContext } from '../access/access.types';
import { CatalogService } from './catalog.service';
import {
  CategoryDto,
  OptionDto,
  OptionGroupDto,
  ProductDto,
  UpdateCategoryDto,
  UpdateOptionDto,
  UpdateOptionGroupDto,
  UpdateProductDto,
  UpdateStoreDto,
  UpdateZoneDto,
  ZoneDto,
} from './cardapio.dto';
import { OrdersService } from './orders.service';

const UUID = new ParseUUIDPipe();

/**
 * Sistema do restaurante: cardápio, loja e pedidos.
 * Leitura: qualquer usuário do restaurante. Alteração: dono e gerente (e a nossa equipe).
 */
@RequireModule('cardapio')
@Controller('cardapio')
export class CardapioManageController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly orders: OrdersService,
  ) {}

  @Get('store')
  getStore(@CurrentTenant() t: TenantContext) {
    return this.catalog.getStore(t.tenantId);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Put('store')
  updateStore(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body() dto: UpdateStoreDto) {
    return this.catalog.updateStore(t.tenantId, u.id, dto);
  }

  @Get('zones')
  listZones(@CurrentTenant() t: TenantContext) {
    return this.catalog.listZones(t.tenantId);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Post('zones')
  createZone(@CurrentTenant() t: TenantContext, @Body() dto: ZoneDto) {
    return this.catalog.createZone(t.tenantId, dto);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Patch('zones/:id')
  updateZone(@CurrentTenant() t: TenantContext, @Param('id', UUID) id: string, @Body() dto: UpdateZoneDto) {
    return this.catalog.updateZone(t.tenantId, id, dto);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Delete('zones/:id')
  deleteZone(@CurrentTenant() t: TenantContext, @Param('id', UUID) id: string) {
    return this.catalog.deleteZone(t.tenantId, id);
  }

  @Get('menu')
  getMenu(@CurrentTenant() t: TenantContext) {
    return this.catalog.getMenu(t.tenantId);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Post('categories')
  createCategory(@CurrentTenant() t: TenantContext, @Body() dto: CategoryDto) {
    return this.catalog.createCategory(t.tenantId, dto);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Patch('categories/:id')
  updateCategory(@CurrentTenant() t: TenantContext, @Param('id', UUID) id: string, @Body() dto: UpdateCategoryDto) {
    return this.catalog.updateCategory(t.tenantId, id, dto);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Delete('categories/:id')
  deleteCategory(@CurrentTenant() t: TenantContext, @Param('id', UUID) id: string) {
    return this.catalog.deleteCategory(t.tenantId, id);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Post('products')
  createProduct(@CurrentTenant() t: TenantContext, @Body() dto: ProductDto) {
    return this.catalog.createProduct(t.tenantId, dto);
  }

  /** Funcionário também pode marcar "esgotado" (só o campo available). */
  @TenantRoles('OWNER', 'MANAGER', 'STAFF')
  @Patch('products/:id/available')
  setAvailable(@CurrentTenant() t: TenantContext, @Param('id', UUID) id: string, @Body() body: UpdateProductDto) {
    return this.catalog.updateProduct(t.tenantId, id, { available: body.available });
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Patch('products/:id')
  updateProduct(@CurrentTenant() t: TenantContext, @Param('id', UUID) id: string, @Body() dto: UpdateProductDto) {
    return this.catalog.updateProduct(t.tenantId, id, dto);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Delete('products/:id')
  deleteProduct(@CurrentTenant() t: TenantContext, @Param('id', UUID) id: string) {
    return this.catalog.deleteProduct(t.tenantId, id);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Post('products/:id/groups')
  createGroup(@CurrentTenant() t: TenantContext, @Param('id', UUID) id: string, @Body() dto: OptionGroupDto) {
    return this.catalog.createGroup(t.tenantId, id, dto);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Patch('groups/:id')
  updateGroup(@CurrentTenant() t: TenantContext, @Param('id', UUID) id: string, @Body() dto: UpdateOptionGroupDto) {
    return this.catalog.updateGroup(t.tenantId, id, dto);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Delete('groups/:id')
  deleteGroup(@CurrentTenant() t: TenantContext, @Param('id', UUID) id: string) {
    return this.catalog.deleteGroup(t.tenantId, id);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Post('groups/:id/options')
  createOption(@CurrentTenant() t: TenantContext, @Param('id', UUID) id: string, @Body() dto: OptionDto) {
    return this.catalog.createOption(t.tenantId, id, dto);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Patch('options/:id')
  updateOption(@CurrentTenant() t: TenantContext, @Param('id', UUID) id: string, @Body() dto: UpdateOptionDto) {
    return this.catalog.updateOption(t.tenantId, id, dto);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Delete('options/:id')
  deleteOption(@CurrentTenant() t: TenantContext, @Param('id', UUID) id: string) {
    return this.catalog.deleteOption(t.tenantId, id);
  }

  /** Lista simples de pedidos; o painel com status e impressão vem na Sprint 3. */
  @Get('orders')
  listOrders(
    @CurrentTenant() t: TenantContext,
    @Query('status', new ParseEnumPipe(OrderStatus, { optional: true })) status?: OrderStatus,
  ) {
    return this.orders.listOrders(t.tenantId, status);
  }
}

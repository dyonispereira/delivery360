import { Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Query, DefaultValuePipe } from '@nestjs/common';
import { CurrentUser, StaffOnly } from '../access/access.decorators';
import type { AuthUser } from '../access/access.types';
import {
  AddTenantUserDto,
  CreateStaffDto,
  CreateTenantDto,
  SetAccountManagersDto,
  SetModuleDto,
  SetPlanDto,
  UpdateTenantDto,
} from './admin.dto';
import { AdminService } from './admin.service';

/**
 * Painel admin (nossa equipe).
 * Super admin: tudo. Gestor de conta: vê e edita os restaurantes da carteira,
 * sem mexer em plano, módulos, status ou equipe.
 */
@StaffOnly()
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('modules')
  listModules() {
    return this.admin.listModules();
  }

  @Get('plans')
  listPlans() {
    return this.admin.listPlans();
  }

  @Get('tenants')
  listTenants(@CurrentUser() actor: AuthUser, @Query('q') q?: string) {
    return this.admin.listTenants(actor, q);
  }

  @StaffOnly('SUPER_ADMIN')
  @Post('tenants')
  createTenant(@CurrentUser() actor: AuthUser, @Body() dto: CreateTenantDto) {
    return this.admin.createTenant(actor, dto);
  }

  @Get('tenants/:id')
  getTenant(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getTenant(actor, id);
  }

  @Patch('tenants/:id')
  updateTenant(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTenantDto) {
    return this.admin.updateTenant(actor, id, dto);
  }

  @StaffOnly('SUPER_ADMIN')
  @Put('tenants/:id/plan')
  setPlan(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetPlanDto) {
    return this.admin.setPlan(actor, id, dto.planId);
  }

  @StaffOnly('SUPER_ADMIN')
  @Put('tenants/:id/modules/:code')
  setModule(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code') code: string,
    @Body() dto: SetModuleDto,
  ) {
    return this.admin.setModule(actor, id, code, dto);
  }

  @Post('tenants/:id/users')
  addTenantUser(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddTenantUserDto) {
    return this.admin.addTenantUser(actor, id, dto);
  }

  @Delete('tenants/:id/users/:userId')
  removeTenantUser(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.admin.removeTenantUser(actor, id, userId);
  }

  @StaffOnly('SUPER_ADMIN')
  @Put('tenants/:id/account-managers')
  setAccountManagers(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetAccountManagersDto) {
    return this.admin.setAccountManagers(actor, id, dto.userIds);
  }

  @StaffOnly('SUPER_ADMIN')
  @Get('staff')
  listStaff() {
    return this.admin.listStaff();
  }

  @StaffOnly('SUPER_ADMIN')
  @Post('staff')
  createStaff(@CurrentUser() actor: AuthUser, @Body() dto: CreateStaffDto) {
    return this.admin.createStaff(actor, dto);
  }

  @StaffOnly('SUPER_ADMIN')
  @Get('audit-logs')
  listAuditLogs(
    @Query('tenantId', new ParseUUIDPipe({ optional: true })) tenantId?: string,
    @Query('take', new DefaultValuePipe(100), ParseIntPipe) take?: number,
  ) {
    return this.admin.listAuditLogs(tenantId, take);
  }
}

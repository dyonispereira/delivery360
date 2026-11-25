import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentTenant, CurrentUser, RequireModule, TenantRoles } from '../access/access.decorators';
import type { AuthUser, TenantContext } from '../access/access.types';
import { AbsenceDto, EmployeeDto, MonthParam, PayrollItemDto, PeriodQuery, UpdateEmployeeDto } from './gestao.dto';
import { PessoasService } from './pessoas.service';

const UUID = new ParseUUIDPipe();

/** Gestão de pessoas: funcionários, folgas e folha. Só dono e gerente (salários são sigilosos). */
@RequireModule('gestao')
@TenantRoles('OWNER', 'MANAGER')
@Controller('gestao')
export class PessoasController {
  constructor(private readonly pessoas: PessoasService) {}

  @Get('employees')
  employees(@CurrentTenant() t: TenantContext) {
    return this.pessoas.employees(t.tenantId);
  }

  @Post('employees')
  createEmployee(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body() dto: EmployeeDto) {
    return this.pessoas.createEmployee(t.tenantId, u.id, dto);
  }

  @Patch('employees/:id')
  updateEmployee(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() dto: UpdateEmployeeDto) {
    return this.pessoas.updateEmployee(t.tenantId, u.id, id, dto);
  }

  @Get('absences')
  absences(@CurrentTenant() t: TenantContext, @Query() q: PeriodQuery) {
    return this.pessoas.absences(t.tenantId, q.from, q.to);
  }

  @Post('absences')
  createAbsence(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body() dto: AbsenceDto) {
    return this.pessoas.createAbsence(t.tenantId, u.id, dto);
  }

  @Delete('absences/:id')
  deleteAbsence(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.pessoas.deleteAbsence(t.tenantId, u.id, id);
  }

  @Get('payroll/:month')
  payroll(@CurrentTenant() t: TenantContext, @Param() p: MonthParam) {
    return this.pessoas.payroll(t.tenantId, p.month);
  }

  @Patch('payroll/items/:id')
  updateItem(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() dto: PayrollItemDto) {
    return this.pessoas.updateItem(t.tenantId, u.id, id, dto);
  }

  @Post('payroll/:month/close')
  @HttpCode(200)
  close(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param() p: MonthParam) {
    return this.pessoas.close(t.tenantId, u.id, p.month);
  }

  @Post('payroll/:month/reopen')
  @HttpCode(200)
  reopen(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param() p: MonthParam) {
    return this.pessoas.reopen(t.tenantId, u.id, p.month);
  }
}

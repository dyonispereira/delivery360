import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  MODULES,
  isModuleCode,
  type ModuleCode,
  type PlanSummary,
  type TenantModuleState,
  type TenantSummary,
} from '@delivery360/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { EventsService } from '../core/events.service';
import { activeModuleCodes } from '../access/access.rules';
import type { AuthUser } from '../access/access.types';
import {
  AddTenantUserDto,
  CreateStaffDto,
  CreateTenantDto,
  SetModuleDto,
  UpdateTenantDto,
} from './admin.dto';

const moduleRowSelect = { moduleCode: true, active: true, startsAt: true, endsAt: true } as const;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  // ---------- Catálogo ----------

  async listModules() {
    return this.prisma.module.findMany({ orderBy: { code: 'asc' } });
  }

  async listPlans(): Promise<PlanSummary[]> {
    const plans = await this.prisma.plan.findMany({
      orderBy: { createdAt: 'asc' },
      include: { modules: { select: { moduleCode: true } } },
    });
    return plans.map((p) => ({
      id: p.id,
      name: p.name,
      modules: p.modules.map((m) => m.moduleCode).filter(isModuleCode).sort(),
    }));
  }

  // ---------- Restaurantes ----------

  /** Super admin vê todos; gestor de conta vê só a carteira. */
  private tenantScopeFilter(actor: AuthUser): Prisma.TenantWhereInput {
    if (actor.staffRole === 'SUPER_ADMIN') return {};
    return { accountManagers: { some: { userId: actor.id } } };
  }

  private async assertCanManage(actor: AuthUser, tenantId: string) {
    const found = await this.prisma.tenant.findFirst({
      where: { id: tenantId, ...this.tenantScopeFilter(actor) },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Restaurante não encontrado.');
  }

  async listTenants(actor: AuthUser, search?: string): Promise<TenantSummary[]> {
    const where: Prisma.TenantWhereInput = { ...this.tenantScopeFilter(actor) };
    if (search?.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { legalName: { contains: q, mode: 'insensitive' } },
        { cnpj: { contains: q.replace(/\D/g, '') || q } },
      ];
    }
    const tenants = await this.prisma.tenant.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { plan: { select: { id: true, name: true } }, modules: { select: moduleRowSelect } },
    });
    return tenants.map((t) => this.toSummary(t));
  }

  async getTenant(actor: AuthUser, tenantId: string) {
    await this.assertCanManage(actor, tenantId);
    const t = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      include: {
        plan: { select: { id: true, name: true } },
        modules: { select: moduleRowSelect },
        memberships: {
          orderBy: { createdAt: 'asc' },
          select: { role: true, user: { select: { id: true, name: true, email: true, active: true } } },
        },
        accountManagers: { select: { user: { select: { id: true, name: true, email: true } } } },
      },
    });
    return {
      ...this.toSummary(t),
      phone: t.phone,
      email: t.email,
      modules: this.moduleStates(t.modules),
      users: t.memberships.map((m) => ({ ...m.user, role: m.role })),
      accountManagers: t.accountManagers.map((a) => a.user),
    };
  }

  async createTenant(actor: AuthUser, dto: CreateTenantDto) {
    const planModules = dto.planId ? await this.planModuleCodes(dto.planId) : [];
    try {
      const tenant = await this.prisma.$transaction(async (tx) => {
        const created = await tx.tenant.create({
          data: {
            name: dto.name.trim(),
            legalName: dto.legalName?.trim() || null,
            cnpj: dto.cnpj || null,
            phone: dto.phone || null,
            email: dto.email || null,
            planId: dto.planId ?? null,
            modules: {
              create: planModules.map((moduleCode) => ({ moduleCode, active: true, startsAt: new Date() })),
            },
          },
        });
        await this.audit.log(
          { tenantId: created.id, userId: actor.id, action: 'tenant.create', entity: 'tenant', entityId: created.id, after: created },
          tx,
        );
        return created;
      });
      return this.getTenant(actor, tenant.id);
    } catch (err) {
      throw this.mapUniqueError(err, 'Já existe um restaurante com este CNPJ.');
    }
  }

  async updateTenant(actor: AuthUser, tenantId: string, dto: UpdateTenantDto) {
    await this.assertCanManage(actor, tenantId);
    if (dto.status && actor.staffRole !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Só o super admin muda o status do restaurante.');
    }
    const before = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    try {
      const after = await this.prisma.tenant.update({
        where: { id: tenantId },
        data: {
          name: dto.name?.trim(),
          legalName: dto.legalName?.trim(),
          cnpj: dto.cnpj,
          phone: dto.phone,
          email: dto.email,
          status: dto.status,
        },
      });
      await this.audit.log({ tenantId, userId: actor.id, action: 'tenant.update', entity: 'tenant', entityId: tenantId, before, after });
    } catch (err) {
      throw this.mapUniqueError(err, 'Já existe um restaurante com este CNPJ.');
    }
    return this.getTenant(actor, tenantId);
  }

  /**
   * Troca o plano e sincroniza as chaves: módulos do plano ficam ligados, os demais desligados.
   * Nenhum dado é apagado; desligar só esconde o módulo.
   */
  async setPlan(actor: AuthUser, tenantId: string, planId: string) {
    await this.assertCanManage(actor, tenantId);
    const planModules = await this.planModuleCodes(planId);
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { planId: true, modules: { select: moduleRowSelect } },
      });
      await tx.tenant.update({ where: { id: tenantId }, data: { planId } });
      const now = new Date();
      for (const code of Object.keys(MODULES) as ModuleCode[]) {
        const shouldBeActive = planModules.includes(code);
        const existing = before.modules.find((m) => m.moduleCode === code);
        if (!existing && !shouldBeActive) continue;
        await tx.tenantModule.upsert({
          where: { tenantId_moduleCode: { tenantId, moduleCode: code } },
          update: { active: shouldBeActive, endsAt: null, ...(shouldBeActive && !existing?.active ? { startsAt: now } : {}) },
          create: { tenantId, moduleCode: code, active: true, startsAt: now },
        });
      }
      await this.audit.log(
        { tenantId, userId: actor.id, action: 'tenant.set_plan', entity: 'tenant', entityId: tenantId, before, after: { planId, modules: planModules } },
        tx,
      );
      await this.events.publish(tenantId, 'tenant.plan_changed', { planId, modules: planModules }, tx);
    });
    return this.getTenant(actor, tenantId);
  }

  /** Liga ou desliga um módulo avulso (ex.: teste grátis com data de fim). */
  async setModule(actor: AuthUser, tenantId: string, code: string, dto: SetModuleDto) {
    if (!isModuleCode(code)) throw new BadRequestException('Módulo inexistente.');
    await this.assertCanManage(actor, tenantId);
    if (dto.endsAt && dto.endsAt <= new Date()) {
      throw new BadRequestException('A data de fim precisa ser no futuro.');
    }
    await this.prisma.$transaction(async (tx) => {
      const key = { tenantId_moduleCode: { tenantId, moduleCode: code } };
      const before = await tx.tenantModule.findUnique({ where: key });
      const after = await tx.tenantModule.upsert({
        where: key,
        update: {
          active: dto.active,
          ...(dto.endsAt !== undefined ? { endsAt: dto.endsAt } : {}),
          ...(dto.active && !before?.active ? { startsAt: new Date() } : {}),
        },
        create: { tenantId, moduleCode: code, active: dto.active, startsAt: new Date(), endsAt: dto.endsAt ?? null },
      });
      await this.audit.log(
        { tenantId, userId: actor.id, action: 'tenant.set_module', entity: 'tenant_module', entityId: code, before, after },
        tx,
      );
      await this.events.publish(tenantId, 'tenant.module_toggled', { module: code, active: dto.active }, tx);
    });
    return this.getTenant(actor, tenantId);
  }

  // ---------- Usuários ----------

  /** Cria o usuário (ou reaproveita a conta pelo e-mail) e vincula ao restaurante. */
  async addTenantUser(actor: AuthUser, tenantId: string, dto: AddTenantUserDto) {
    await this.assertCanManage(actor, tenantId);
    const email = dto.email.trim().toLowerCase();
    await this.prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({ where: { email } });
      if (user?.staffRole) throw new ConflictException('Este e-mail pertence à nossa equipe.');
      if (!user) {
        if (!dto.password) throw new BadRequestException('Informe uma senha para o novo usuário.');
        user = await tx.user.create({
          data: { name: dto.name.trim(), email, passwordHash: await bcrypt.hash(dto.password, 10) },
        });
      }
      const existing = await tx.membership.findUnique({ where: { userId_tenantId: { userId: user.id, tenantId } } });
      if (existing) throw new ConflictException('Este usuário já tem acesso ao restaurante.');
      await tx.membership.create({ data: { userId: user.id, tenantId, role: dto.role } });
      await this.audit.log(
        { tenantId, userId: actor.id, action: 'membership.create', entity: 'membership', entityId: user.id, after: { email, role: dto.role } },
        tx,
      );
    });
    return this.getTenant(actor, tenantId);
  }

  async removeTenantUser(actor: AuthUser, tenantId: string, userId: string) {
    await this.assertCanManage(actor, tenantId);
    const removed = await this.prisma.membership.deleteMany({ where: { tenantId, userId } });
    if (removed.count === 0) throw new NotFoundException('Usuário não vinculado a este restaurante.');
    await this.audit.log({ tenantId, userId: actor.id, action: 'membership.delete', entity: 'membership', entityId: userId });
    return this.getTenant(actor, tenantId);
  }

  async listStaff() {
    return this.prisma.user.findMany({
      where: { staffRole: { not: null } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true, staffRole: true, active: true },
    });
  }

  async createStaff(actor: AuthUser, dto: CreateStaffDto) {
    const email = dto.email.trim().toLowerCase();
    try {
      const user = await this.prisma.user.create({
        data: {
          name: dto.name.trim(),
          email,
          staffRole: dto.staffRole,
          passwordHash: await bcrypt.hash(dto.password, 10),
        },
        select: { id: true, name: true, email: true, staffRole: true, active: true },
      });
      await this.audit.log({ userId: actor.id, action: 'staff.create', entity: 'user', entityId: user.id, after: user });
      return user;
    } catch (err) {
      throw this.mapUniqueError(err, 'Já existe um usuário com este e-mail.');
    }
  }

  async setAccountManagers(actor: AuthUser, tenantId: string, userIds: string[]) {
    await this.assertCanManage(actor, tenantId);
    const unique = [...new Set(userIds)];
    const managers = await this.prisma.user.count({ where: { id: { in: unique }, staffRole: 'ACCOUNT_MANAGER' } });
    if (managers !== unique.length) throw new BadRequestException('Todos os usuários precisam ser gestores de conta.');
    await this.prisma.$transaction(async (tx) => {
      await tx.accountManagerTenant.deleteMany({ where: { tenantId } });
      await tx.accountManagerTenant.createMany({ data: unique.map((userId) => ({ userId, tenantId })) });
      await this.audit.log(
        { tenantId, userId: actor.id, action: 'tenant.set_account_managers', entity: 'tenant', entityId: tenantId, after: { userIds: unique } },
        tx,
      );
    });
    return this.getTenant(actor, tenantId);
  }

  async listAuditLogs(tenantId?: string, take = 100) {
    return this.prisma.auditLog.findMany({
      where: tenantId ? { tenantId } : {},
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(take, 1), 500),
      include: { user: { select: { name: true, email: true } } },
    });
  }

  // ---------- Auxiliares ----------

  private async planModuleCodes(planId: string): Promise<ModuleCode[]> {
    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
      include: { modules: { select: { moduleCode: true } } },
    });
    if (!plan) throw new BadRequestException('Plano não encontrado.');
    return plan.modules.map((m) => m.moduleCode).filter(isModuleCode);
  }

  private moduleStates(rows: { moduleCode: string; active: boolean; startsAt: Date | null; endsAt: Date | null }[]): TenantModuleState[] {
    const active = new Set(activeModuleCodes(rows));
    return (Object.keys(MODULES) as ModuleCode[]).map((code) => {
      const row = rows.find((r) => r.moduleCode === code);
      return {
        code,
        name: MODULES[code].name,
        active: active.has(code),
        startsAt: row?.startsAt?.toISOString() ?? null,
        endsAt: row?.endsAt?.toISOString() ?? null,
      };
    });
  }

  private toSummary(t: {
    id: string;
    name: string;
    legalName: string | null;
    cnpj: string | null;
    status: TenantSummary['status'];
    createdAt: Date;
    plan: { id: string; name: string } | null;
    modules: { moduleCode: string; active: boolean; startsAt: Date | null; endsAt: Date | null }[];
  }): TenantSummary {
    return {
      id: t.id,
      name: t.name,
      legalName: t.legalName,
      cnpj: t.cnpj,
      status: t.status,
      plan: t.plan,
      activeModules: activeModuleCodes(t.modules),
      createdAt: t.createdAt.toISOString(),
    };
  }

  private mapUniqueError(err: unknown, message: string) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException(message);
    }
    return err;
  }
}

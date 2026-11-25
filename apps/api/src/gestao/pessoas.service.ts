import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { fromDbDate, toDbDate } from './chart';
import { GestaoSyncService } from './gestao-sync.service';
import { AbsenceDto, EmployeeDto, PayrollItemDto, UpdateEmployeeDto } from './gestao.dto';
import { calcPayroll, monthDays } from './payroll';

const TYPE_LABEL = { CLT: 'CLT', PJ: 'PJ', DIARISTA: 'diarista', ESTAGIO: 'estágio' } as const;

const employeeView = <T extends { admissionDate: Date; terminationDate: Date | null }>(e: T) => ({
  ...e,
  admissionDate: fromDbDate(e.admissionDate),
  terminationDate: e.terminationDate ? fromDbDate(e.terminationDate) : null,
});

/** Dia N do mês seguinte a "2026-11" -> "2026-12-05". */
const nextMonthDay = (month: string, day: number) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, day)).toISOString().slice(0, 10);
};

/**
 * Gestão de pessoas: funcionários, folgas/férias/atestados/faltas e folha gerencial do mês.
 * Fechar a folha gera as contas a pagar no grupo 4 (despesas com pessoal), que entram na DRE.
 */
@Injectable()
export class PessoasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sync: GestaoSyncService,
  ) {}

  // ---------- Funcionários ----------

  async employees(tenantId: string) {
    const rows = await this.prisma.employee.findMany({ where: { tenantId }, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
    return rows.map(employeeView);
  }

  async createEmployee(tenantId: string, userId: string, dto: EmployeeDto) {
    this.checkPay(dto.type, dto.salaryCents ?? 0, dto.dailyRateCents ?? 0);
    const e = await this.prisma.employee.create({
      data: { ...dto, tenantId, name: dto.name.trim(), role: dto.role.trim(), admissionDate: toDbDate(dto.admissionDate) },
    });
    await this.audit.log({ tenantId, userId, action: 'employee.create', entity: 'employee', entityId: e.id, after: { name: e.name, type: e.type } });
    return employeeView(e);
  }

  async updateEmployee(tenantId: string, userId: string, id: string, dto: UpdateEmployeeDto) {
    const before = await this.employee(tenantId, id);
    const type = dto.type ?? before.type;
    this.checkPay(type, dto.salaryCents ?? before.salaryCents, dto.dailyRateCents ?? before.dailyRateCents);
    const { terminationDate, admissionDate, ...rest } = dto;
    const term = terminationDate === undefined ? undefined : terminationDate ? toDbDate(terminationDate) : null;
    const adm = admissionDate ? toDbDate(admissionDate) : undefined;
    if (term && term < (adm ?? before.admissionDate)) throw new BadRequestException('O desligamento é antes da admissão.');
    const e = await this.prisma.employee.update({
      where: { id },
      data: {
        ...rest,
        name: dto.name?.trim(),
        role: dto.role?.trim(),
        admissionDate: adm,
        terminationDate: term,
        // Desligado sai da escala; desfazer o desligamento reativa.
        active: term === undefined ? undefined : term === null,
      },
    });
    await this.audit.log({ tenantId, userId, action: 'employee.update', entity: 'employee', entityId: id, before: employeeView(before), after: dto });
    return employeeView(e);
  }

  // ---------- Folgas, férias, atestados e faltas ----------

  async absences(tenantId: string, from: string, to: string) {
    const rows = await this.prisma.absence.findMany({
      where: { tenantId, startDate: { lte: toDbDate(to) }, endDate: { gte: toDbDate(from) } },
      include: { employee: { select: { name: true } } },
      orderBy: { startDate: 'asc' },
    });
    return rows.map((a) => ({ ...a, startDate: fromDbDate(a.startDate), endDate: fromDbDate(a.endDate) }));
  }

  async createAbsence(tenantId: string, userId: string, dto: AbsenceDto) {
    await this.employee(tenantId, dto.employeeId);
    if (dto.endDate < dto.startDate) throw new BadRequestException('A data final é antes da inicial.');
    await this.assertMonthsOpen(tenantId, dto.startDate, dto.endDate);
    const a = await this.prisma.absence.create({
      data: { tenantId, employeeId: dto.employeeId, kind: dto.kind, startDate: toDbDate(dto.startDate), endDate: toDbDate(dto.endDate), notes: dto.notes?.trim() || null },
    });
    await this.audit.log({ tenantId, userId, action: 'absence.create', entity: 'absence', entityId: a.id, after: dto });
    return { ...a, startDate: dto.startDate, endDate: dto.endDate };
  }

  async deleteAbsence(tenantId: string, userId: string, id: string) {
    const a = await this.prisma.absence.findFirst({ where: { id, tenantId } });
    if (!a) throw new NotFoundException('Registro não encontrado.');
    await this.assertMonthsOpen(tenantId, fromDbDate(a.startDate), fromDbDate(a.endDate));
    await this.prisma.absence.delete({ where: { id } });
    await this.audit.log({ tenantId, userId, action: 'absence.delete', entity: 'absence', entityId: id, before: a });
    return { ok: true };
  }

  // ---------- Folha do mês ----------

  /** Folha do mês. Em rascunho, é recalculada a cada abertura (funcionários, faltas, valores). */
  async payroll(tenantId: string, month: string) {
    const payroll = await this.prisma.payroll.upsert({
      where: { tenantId_month: { tenantId, month } },
      update: {},
      create: { tenantId, month },
    });
    if (payroll.status === 'DRAFT') await this.recalc(tenantId, payroll.id, month);
    return this.view(tenantId, payroll.id);
  }

  async updateItem(tenantId: string, userId: string, itemId: string, dto: PayrollItemDto) {
    const item = await this.prisma.payrollItem.findFirst({ where: { id: itemId, payroll: { tenantId } }, include: { payroll: true, employee: true } });
    if (!item) throw new NotFoundException('Linha da folha não encontrada.');
    if (item.payroll.status !== 'DRAFT') throw new ConflictException('A folha deste mês está fechada. Reabra para alterar.');
    if (dto.days !== undefined && item.employee.type !== 'DIARISTA') throw new BadRequestException('Os dias só são informados para diaristas.');
    await this.prisma.payrollItem.update({
      where: { id: itemId },
      data: { extrasCents: dto.extrasCents, bonusCents: dto.bonusCents, advanceCents: dto.advanceCents, days: dto.days, notes: dto.notes?.trim() },
    });
    await this.recalc(tenantId, item.payrollId, item.payroll.month);
    await this.audit.log({ tenantId, userId, action: 'payroll.item', entity: 'payroll_item', entityId: itemId, after: dto });
    return this.view(tenantId, item.payrollId);
  }

  /** Fecha a folha: gera as contas a pagar (salários, extras, encargos, benefícios e reserva de férias/13º). */
  async close(tenantId: string, userId: string, month: string) {
    const payroll = await this.prisma.payroll.findUnique({ where: { tenantId_month: { tenantId, month } } });
    if (!payroll) throw new NotFoundException('Abra a folha do mês primeiro.');
    if (payroll.status === 'CLOSED') throw new ConflictException('A folha deste mês já está fechada.');
    await this.recalc(tenantId, payroll.id, month);
    const items = await this.prisma.payrollItem.findMany({ where: { payrollId: payroll.id }, include: { employee: true } });
    const active = items.filter((i) => i.baseCents + i.extrasCents + i.bonusCents > 0);
    if (active.length === 0) throw new BadRequestException('Não há valores na folha deste mês.');

    const rates = await this.sync.rates(this.prisma, tenantId);
    const competence = `${month}-${String(monthDays(month)).padStart(2, '0')}`;
    const payDay = nextMonthDay(month, rates.payDay);
    const label = monthLabel(month);
    const key = (s: string) => `payroll:${payroll.id}:${s}`;

    await this.prisma.$transaction(async (tx) => {
      for (const i of active) {
        const e = i.employee;
        const base = { day: competence, source: 'pessoas', counterparty: e.name } as const;
        // Diarista e PJ: conta de freelancers / salários; CLT e estágio: salários.
        const code = e.type === 'DIARISTA' ? '4.3' : '4.1';
        const extra = i.extrasCents + i.bonusCents;
        let salary = i.baseCents - i.absenceCents - i.advanceCents;
        let extraDue = extra;
        if (salary < 0) {
          extraDue = Math.max(0, extra + salary);
          salary = 0;
        }
        if (i.advanceCents > 0) {
          // Adiantamento já saiu do caixa: entra pago, para a DRE ter o custo inteiro.
          await this.sync.upsert(tx, tenantId, key(`${e.id}:advance`), {
            ...base,
            type: 'PAYABLE',
            code,
            description: `Adiantamento ${label} · ${e.name}`,
            amountCents: Math.min(i.advanceCents, i.baseCents - i.absenceCents + extra),
            status: 'PAID',
          });
        }
        if (salary > 0) {
          await this.sync.upsert(tx, tenantId, key(`${e.id}:salary`), {
            ...base,
            type: 'PAYABLE',
            code,
            description: `${e.type === 'DIARISTA' ? `Diárias (${i.days})` : 'Salário'} ${label} · ${e.name} (${TYPE_LABEL[e.type]})`,
            amountCents: salary,
            dueDay: payDay,
            status: 'OPEN',
          });
        }
        if (extraDue > 0) {
          await this.sync.upsert(tx, tenantId, key(`${e.id}:extras`), {
            ...base,
            type: 'PAYABLE',
            code: '4.2',
            description: `Extras e prêmios ${label} · ${e.name}`,
            amountCents: extraDue,
            dueDay: payDay,
            status: 'OPEN',
          });
        }
      }
      const sum = (f: (i: (typeof active)[number]) => number) => active.reduce((t, i) => t + f(i), 0);
      const charges = sum((i) => i.chargesCents);
      const benefits = sum((i) => i.benefitsCents);
      const provision = sum((i) => i.provisionCents);
      const common = { day: competence, source: 'pessoas', type: 'PAYABLE', status: 'OPEN' } as const;
      if (charges > 0) {
        await this.sync.upsert(tx, tenantId, key('charges'), {
          ...common,
          code: '4.4',
          description: `Encargos da folha ${label} (FGTS e INSS patronal)`,
          amountCents: charges,
          dueDay: nextMonthDay(month, 20),
        });
      }
      if (benefits > 0) {
        await this.sync.upsert(tx, tenantId, key('benefits'), {
          ...common,
          code: '4.5',
          description: `Vale-transporte e alimentação ${label}`,
          amountCents: benefits,
          dueDay: payDay,
        });
      }
      if (provision > 0) {
        // Reserva: vence em 20/12 (13º); as férias saem dela quando forem tiradas.
        await this.sync.upsert(tx, tenantId, key('provision'), {
          ...common,
          code: '4.6',
          description: `Reserva de férias e 13º ${label}`,
          amountCents: provision,
          dueDay: `${month.slice(0, 4)}-12-20`,
        });
      }
      await tx.payroll.update({ where: { id: payroll.id }, data: { status: 'CLOSED', closedAt: new Date() } });
    });
    await this.audit.log({ tenantId, userId, action: 'payroll.close', entity: 'payroll', entityId: payroll.id, after: { month } });
    return this.view(tenantId, payroll.id);
  }

  /** Reabre a folha: apaga os lançamentos gerados, desde que nenhum tenha sido pago. */
  async reopen(tenantId: string, userId: string, month: string) {
    const payroll = await this.prisma.payroll.findUnique({ where: { tenantId_month: { tenantId, month } } });
    if (!payroll || payroll.status !== 'CLOSED') throw new ConflictException('A folha deste mês não está fechada.');
    const prefix = `payroll:${payroll.id}:`;
    const entries = await this.prisma.financialEntry.findMany({ where: { tenantId, externalKey: { startsWith: prefix } } });
    const paid = entries.filter((e) => e.status === 'PAID' && !e.externalKey!.endsWith(':advance'));
    if (paid.length > 0) {
      throw new ConflictException(`Já há pagamentos desta folha (${paid.map((e) => e.description).slice(0, 2).join('; ')}). Desfaça a baixa antes de reabrir.`);
    }
    await this.prisma.$transaction([
      this.prisma.financialEntry.deleteMany({ where: { tenantId, externalKey: { startsWith: prefix } } }),
      this.prisma.payroll.update({ where: { id: payroll.id }, data: { status: 'DRAFT', closedAt: null } }),
    ]);
    await this.audit.log({ tenantId, userId, action: 'payroll.reopen', entity: 'payroll', entityId: payroll.id, after: { month, removed: entries.length } });
    return this.payroll(tenantId, month);
  }

  // ---------- Auxiliares ----------

  /** Recalcula as linhas da folha em rascunho, mantendo o que foi digitado (extras, prêmio, adiantamento, diárias). */
  private async recalc(tenantId: string, payrollId: string, month: string) {
    const first = `${month}-01`;
    const last = `${month}-${String(monthDays(month)).padStart(2, '0')}`;
    const [employees, absences, items, rates] = await Promise.all([
      this.prisma.employee.findMany({
        where: { tenantId, admissionDate: { lte: toDbDate(last) }, OR: [{ terminationDate: null }, { terminationDate: { gte: toDbDate(first) } }] },
      }),
      this.prisma.absence.findMany({ where: { tenantId, startDate: { lte: toDbDate(last) }, endDate: { gte: toDbDate(first) } } }),
      this.prisma.payrollItem.findMany({ where: { payrollId } }),
      this.sync.rates(this.prisma, tenantId),
    ]);
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    for (const e of employees) {
      const prev = items.find((i) => i.employeeId === e.id);
      const calc = calcPayroll(
        month,
        {
          type: e.type,
          salaryCents: e.salaryCents,
          dailyRateCents: e.dailyRateCents,
          transportCents: e.transportCents,
          mealCents: e.mealCents,
          admissionDate: fromDbDate(e.admissionDate),
          terminationDate: e.terminationDate ? fromDbDate(e.terminationDate) : null,
        },
        absences.filter((a) => a.employeeId === e.id).map((a) => ({ kind: a.kind, startDate: fromDbDate(a.startDate), endDate: fromDbDate(a.endDate) })),
        { days: prev?.days, extrasCents: prev?.extrasCents, bonusCents: prev?.bonusCents, advanceCents: prev?.advanceCents },
        rates,
      );
      const { costCents: _c, ...data } = calc;
      ops.push(
        this.prisma.payrollItem.upsert({
          where: { payrollId_employeeId: { payrollId, employeeId: e.id } },
          update: data,
          create: { payrollId, employeeId: e.id, ...data },
        }),
      );
    }
    // Quem não está mais no mês (ex.: admissão mudou) sai da folha.
    const ids = employees.map((e) => e.id);
    ops.push(this.prisma.payrollItem.deleteMany({ where: { payrollId, employeeId: { notIn: ids } } }));
    await this.prisma.$transaction(ops);
  }

  private async view(tenantId: string, payrollId: string) {
    const p = await this.prisma.payroll.findFirstOrThrow({
      where: { id: payrollId, tenantId },
      include: { items: { include: { employee: { select: { id: true, name: true, role: true, type: true, salaryCents: true, dailyRateCents: true } } } } },
    });
    const items = p.items
      .map((i) => {
        const gross = Math.max(0, i.baseCents - i.absenceCents) + i.extrasCents + i.bonusCents;
        return { ...i, grossCents: gross, costCents: gross + i.benefitsCents + i.chargesCents + i.provisionCents };
      })
      .sort((a, b) => a.employee.name.localeCompare(b.employee.name, 'pt-BR'));
    const total = (k: 'grossCents' | 'netCents' | 'benefitsCents' | 'chargesCents' | 'provisionCents' | 'costCents' | 'advanceCents') =>
      items.reduce((t, i) => t + i[k], 0);
    return {
      id: p.id,
      month: p.month,
      status: p.status,
      closedAt: p.closedAt,
      items,
      totals: {
        grossCents: total('grossCents'),
        advanceCents: total('advanceCents'),
        netCents: total('netCents'),
        benefitsCents: total('benefitsCents'),
        chargesCents: total('chargesCents'),
        provisionCents: total('provisionCents'),
        costCents: total('costCents'),
      },
    };
  }

  /** Folga/falta mexe na folha: não deixa alterar mês com folha fechada. */
  private async assertMonthsOpen(tenantId: string, start: string, end: string) {
    const months = new Set([start.slice(0, 7), end.slice(0, 7)]);
    const closed = await this.prisma.payroll.findFirst({ where: { tenantId, month: { in: [...months] }, status: 'CLOSED' } });
    if (closed) throw new ConflictException(`A folha de ${monthLabel(closed.month)} está fechada. Reabra para mudar folgas e faltas desse mês.`);
  }

  private async employee(tenantId: string, id: string) {
    const e = await this.prisma.employee.findFirst({ where: { id, tenantId } });
    if (!e) throw new NotFoundException('Funcionário não encontrado.');
    return e;
  }

  private checkPay(type: string, salary: number, daily: number) {
    if (type === 'DIARISTA' && daily <= 0) throw new BadRequestException('Informe o valor da diária.');
    if (type !== 'DIARISTA' && salary <= 0) throw new BadRequestException('Informe o salário.');
  }
}

/** "2026-11" -> "11/2026" */
function monthLabel(month: string) {
  return `${month.slice(5)}/${month.slice(0, 4)}`;
}

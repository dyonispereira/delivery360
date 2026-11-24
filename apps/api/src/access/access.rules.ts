import type { ModuleCode, StaffRole, TenantRole } from '@delivery360/shared';
import { isModuleCode } from '@delivery360/shared';

/** Regras de acesso puras (sem banco), para serem fáceis de testar. */

export interface TenantModuleRow {
  moduleCode: string;
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
}

/** Um módulo está liberado se a chave estiver ligada e "agora" estiver dentro do período. */
export function isModuleActive(row: TenantModuleRow, now: Date = new Date()): boolean {
  if (!row.active) return false;
  if (row.startsAt && row.startsAt > now) return false;
  if (row.endsAt && row.endsAt <= now) return false;
  return true;
}

export function activeModuleCodes(rows: TenantModuleRow[], now: Date = new Date()): ModuleCode[] {
  return rows
    .filter((r) => isModuleActive(r, now))
    .map((r) => r.moduleCode)
    .filter(isModuleCode)
    .sort();
}

export interface TenantAccessInput {
  staffRole: StaffRole | null;
  /** Papel do usuário neste restaurante, se tiver vínculo. */
  membershipRole: TenantRole | null;
  /** Se o restaurante está na carteira do gestor de conta. */
  isAssignedAccountManager: boolean;
  tenantStatus: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
}

export type TenantAccessResult =
  | { allowed: true; role: TenantRole | null }
  | { allowed: false; reason: 'NO_ACCESS' | 'TENANT_INACTIVE' };

/**
 * Quem pode entrar num restaurante:
 * - super admin: qualquer um (inclusive suspenso, para poder resolver);
 * - gestor de conta: só os da carteira (inclusive suspensos);
 * - usuário do restaurante: só se tiver vínculo e o restaurante estiver ativo.
 */
export function resolveTenantAccess(input: TenantAccessInput): TenantAccessResult {
  if (input.staffRole === 'SUPER_ADMIN') {
    return { allowed: true, role: input.membershipRole };
  }
  if (input.staffRole === 'ACCOUNT_MANAGER' && input.isAssignedAccountManager) {
    return { allowed: true, role: input.membershipRole };
  }
  if (!input.membershipRole) return { allowed: false, reason: 'NO_ACCESS' };
  if (input.tenantStatus !== 'ACTIVE') return { allowed: false, reason: 'TENANT_INACTIVE' };
  return { allowed: true, role: input.membershipRole };
}

/** Papéis de restaurante: a equipe (staff) passa sempre; o resto precisa estar na lista. */
export function hasTenantRole(
  staffRole: StaffRole | null,
  role: TenantRole | null,
  required: TenantRole[],
): boolean {
  if (required.length === 0) return true;
  if (staffRole) return true;
  return role !== null && required.includes(role);
}

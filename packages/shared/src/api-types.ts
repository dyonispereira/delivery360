import type { ModuleCode } from './modules';
import type { StaffRole, TenantRole } from './roles';

export type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';

export interface LoginResponse {
  accessToken: string;
  user: MeResponse;
}

export interface MeTenant {
  id: string;
  name: string;
  status: TenantStatus;
  /** Papel do usuário no restaurante; null quando o acesso vem da equipe (admin/gestor de conta). */
  role: TenantRole | null;
  activeModules: ModuleCode[];
}

export interface MeResponse {
  id: string;
  name: string;
  email: string;
  staffRole: StaffRole | null;
  tenants: MeTenant[];
}

export interface TenantModuleState {
  code: ModuleCode;
  name: string;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

export interface TenantSummary {
  id: string;
  name: string;
  legalName: string | null;
  cnpj: string | null;
  status: TenantStatus;
  plan: { id: string; name: string } | null;
  activeModules: ModuleCode[];
  createdAt: string;
}

export interface PlanSummary {
  id: string;
  name: string;
  modules: ModuleCode[];
}

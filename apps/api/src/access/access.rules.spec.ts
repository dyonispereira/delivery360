import { activeModuleCodes, hasTenantRole, isModuleActive, resolveTenantAccess } from './access.rules';

const now = new Date('2026-11-24T12:00:00Z');
const row = (o: Partial<{ moduleCode: string; active: boolean; startsAt: Date | null; endsAt: Date | null }> = {}) => ({
  moduleCode: 'gestao',
  active: true,
  startsAt: null,
  endsAt: null,
  ...o,
});

describe('isModuleActive', () => {
  it('libera chave ligada sem datas', () => expect(isModuleActive(row(), now)).toBe(true));
  it('bloqueia chave desligada', () => expect(isModuleActive(row({ active: false }), now)).toBe(false));
  it('bloqueia antes do início', () =>
    expect(isModuleActive(row({ startsAt: new Date('2026-12-01') }), now)).toBe(false));
  it('bloqueia depois do fim (teste grátis acabou)', () =>
    expect(isModuleActive(row({ endsAt: new Date('2026-11-24T11:59:59Z') }), now)).toBe(false));
  it('libera dentro do período', () =>
    expect(
      isModuleActive(row({ startsAt: new Date('2026-11-01'), endsAt: new Date('2026-12-01') }), now),
    ).toBe(true));
});

describe('activeModuleCodes', () => {
  it('lista só módulos ativos e conhecidos, em ordem', () => {
    expect(
      activeModuleCodes(
        [row({ moduleCode: 'trafego' }), row({ moduleCode: 'gestao' }), row({ moduleCode: 'cardapio', active: false }), row({ moduleCode: 'desconhecido' })],
        now,
      ),
    ).toEqual(['gestao', 'trafego']);
  });
});

describe('resolveTenantAccess', () => {
  const base = { staffRole: null, membershipRole: null, isAssignedAccountManager: false, tenantStatus: 'ACTIVE' as const };

  it('super admin entra em qualquer restaurante, mesmo suspenso', () =>
    expect(resolveTenantAccess({ ...base, staffRole: 'SUPER_ADMIN', tenantStatus: 'SUSPENDED' })).toEqual({ allowed: true, role: null }));

  it('gestor de conta só entra nos restaurantes da carteira', () => {
    expect(resolveTenantAccess({ ...base, staffRole: 'ACCOUNT_MANAGER' }).allowed).toBe(false);
    expect(resolveTenantAccess({ ...base, staffRole: 'ACCOUNT_MANAGER', isAssignedAccountManager: true }).allowed).toBe(true);
  });

  it('usuário sem vínculo não entra', () =>
    expect(resolveTenantAccess(base)).toEqual({ allowed: false, reason: 'NO_ACCESS' }));

  it('usuário do restaurante entra com seu papel', () =>
    expect(resolveTenantAccess({ ...base, membershipRole: 'MANAGER' })).toEqual({ allowed: true, role: 'MANAGER' }));

  it('restaurante suspenso bloqueia o usuário do restaurante', () =>
    expect(resolveTenantAccess({ ...base, membershipRole: 'OWNER', tenantStatus: 'SUSPENDED' })).toEqual({
      allowed: false,
      reason: 'TENANT_INACTIVE',
    }));
});

describe('hasTenantRole', () => {
  it('sem exigência, todos passam', () => expect(hasTenantRole(null, 'STAFF', [])).toBe(true));
  it('equipe sempre passa', () => expect(hasTenantRole('ACCOUNT_MANAGER', null, ['OWNER'])).toBe(true));
  it('confere o papel no restaurante', () => {
    expect(hasTenantRole(null, 'MANAGER', ['OWNER', 'MANAGER'])).toBe(true);
    expect(hasTenantRole(null, 'STAFF', ['OWNER', 'MANAGER'])).toBe(false);
  });
});

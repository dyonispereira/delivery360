/**
 * Módulos de negócio que podem ser ligados ou desligados por restaurante.
 * O código é a "chave" usada no banco (tabela modules), nos guards da API e no menu da web.
 */
export const MODULE_CODES = ['gestao', 'cardapio', 'entregas', 'trafego'] as const;

export type ModuleCode = (typeof MODULE_CODES)[number];

export interface ModuleDefinition {
  code: ModuleCode;
  name: string;
  description: string;
  /** Caminho da área do módulo no sistema do restaurante (web). */
  path: string;
}

export const MODULES: Record<ModuleCode, ModuleDefinition> = {
  gestao: {
    code: 'gestao',
    name: 'Gestão',
    description: 'Funcionários, escala e folgas, folha, financeiro e resultado (DRE).',
    path: '/app/gestao',
  },
  cardapio: {
    code: 'cardapio',
    name: 'Cardápio e pedidos',
    description: 'Loja online, pagamentos, painel de pedidos, impressão e cozinha.',
    path: '/app/cardapio',
  },
  entregas: {
    code: 'entregas',
    name: 'Entregas',
    description: 'Motoboys, lotes de entrega e app do entregador.',
    path: '/app/entregas',
  },
  trafego: {
    code: 'trafego',
    name: 'Tráfego',
    description: 'Campanhas, links UTM, gastos e retorno por pedido.',
    path: '/app/trafego',
  },
};

export function isModuleCode(value: string): value is ModuleCode {
  return (MODULE_CODES as readonly string[]).includes(value);
}

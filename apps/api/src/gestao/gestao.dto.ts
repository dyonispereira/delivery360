import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MSG = { message: 'Data inválida (use AAAA-MM-DD).' };

export class AccountDto {
  @IsInt() @Min(1) @Max(11) group: number;
  @IsString() @MinLength(2) @MaxLength(80) name: string;
}

export class UpdateAccountDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class EntryDto {
  @IsIn(['RECEIVABLE', 'PAYABLE']) type: 'RECEIVABLE' | 'PAYABLE';
  @IsUUID() accountId: string;
  @IsString() @MinLength(2) @MaxLength(120) description: string;
  @IsOptional() @IsString() @MaxLength(80) counterparty?: string;
  @IsInt() @Min(1, { message: 'Informe o valor.' }) @Max(100_000_000) amountCents: number;
  /** Mês/dia a que a despesa ou receita pertence (vai para a DRE). */
  @Matches(DATE, DATE_MSG) competenceDate: string;
  @Matches(DATE, DATE_MSG) dueDate: string;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
  /** Já pago/recebido nesta data. */
  @IsOptional() @Matches(DATE, DATE_MSG) paidAt?: string;
  /** Repetir todo mês (ex.: aluguel): quantos meses no total, contando este. */
  @IsOptional() @IsInt() @Min(1) @Max(24) repeatMonths?: number;
}

export class UpdateEntryDto {
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) description?: string;
  @IsOptional() @IsString() @MaxLength(80) counterparty?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100_000_000) amountCents?: number;
  @IsOptional() @Matches(DATE, DATE_MSG) competenceDate?: string;
  @IsOptional() @Matches(DATE, DATE_MSG) dueDate?: string;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

export class PayDto {
  @IsOptional() @Matches(DATE, DATE_MSG) paidAt?: string;
}

export class PayManyDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsUUID('all', { each: true }) ids: string[];
  @IsOptional() @Matches(DATE, DATE_MSG) paidAt?: string;
}

export class PeriodQuery {
  @Matches(DATE, DATE_MSG) from: string;
  @Matches(DATE, DATE_MSG) to: string;
}

/** Percentuais em pontos-base (100 = 1%). */
export class FinanceSettingsDto {
  @IsOptional() @IsInt() @Min(0) @Max(5000) salesTaxBps?: number;
  @IsOptional() @IsInt() @Min(0) @Max(2000) pixFeeBps?: number;
  @IsOptional() @IsInt() @Min(0) @Max(2000) creditFeeBps?: number;
  @IsOptional() @IsInt() @Min(0) @Max(2000) cardOnDeliveryFeeBps?: number;
  @IsOptional() @IsInt() @Min(0) @Max(8000) targetMarginBps?: number;
  @IsOptional() @IsInt() @Min(1) @Max(28) taxDueDay?: number;
  @IsOptional() @IsInt() @Min(0) @Max(2000) fgtsBps?: number;
  @IsOptional() @IsInt() @Min(0) @Max(3000) employerInssBps?: number;
  @IsOptional() @IsInt() @Min(1) @Max(28) payDay?: number;
}

// ---------- Gestão de pessoas ----------

const EMPLOYMENT = ['CLT', 'PJ', 'DIARISTA', 'ESTAGIO'] as const;
const MAX_CENTS = 10_000_000;

export class EmployeeDto {
  @IsString() @MinLength(2, { message: 'Informe o nome.' }) @MaxLength(80) name: string;
  @IsString() @MinLength(2, { message: 'Informe o cargo.' }) @MaxLength(60) role: string;
  @IsIn(EMPLOYMENT) type: (typeof EMPLOYMENT)[number];
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsString() @MaxLength(20) document?: string;
  @IsOptional() @IsString() @MaxLength(80) pixKey?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) salaryCents?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) dailyRateCents?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) transportCents?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) mealCents?: number;
  @IsOptional() @IsInt() @Min(0) @Max(6) weeklyDayOff?: number | null;
  @Matches(DATE, DATE_MSG) admissionDate: string;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

export class UpdateEmployeeDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) role?: string;
  @IsOptional() @IsIn(EMPLOYMENT) type?: (typeof EMPLOYMENT)[number];
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsString() @MaxLength(20) document?: string;
  @IsOptional() @IsString() @MaxLength(80) pixKey?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) salaryCents?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) dailyRateCents?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) transportCents?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) mealCents?: number;
  /** null tira a folga fixa. */
  @IsOptional() @IsInt() @Min(0) @Max(6) weeklyDayOff?: number | null;
  @IsOptional() @Matches(DATE, DATE_MSG) admissionDate?: string;
  /** Desligamento: o funcionário sai da escala e da folha depois desta data. "" desfaz. */
  @IsOptional() @Matches(/^(\d{4}-\d{2}-\d{2})?$/, DATE_MSG) terminationDate?: string;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

export class AbsenceDto {
  @IsUUID() employeeId: string;
  @IsIn(['FOLGA', 'FERIAS', 'ATESTADO', 'FALTA']) kind: 'FOLGA' | 'FERIAS' | 'ATESTADO' | 'FALTA';
  @Matches(DATE, DATE_MSG) startDate: string;
  @Matches(DATE, DATE_MSG) endDate: string;
  @IsOptional() @IsString() @MaxLength(200) notes?: string;
}

export class MonthParam {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Mês inválido (use AAAA-MM).' }) month: string;
}

export class PayrollItemDto {
  @IsOptional() @IsInt() @Min(0) @Max(31) days?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) extrasCents?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) bonusCents?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) advanceCents?: number;
  @IsOptional() @IsString() @MaxLength(200) notes?: string;
}

export class MarginQuery extends PeriodQuery {
  @IsOptional() @IsIn(['LOJA', 'IFOOD', 'FOOD99', 'KEETA']) channel?: 'LOJA' | 'IFOOD' | 'FOOD99' | 'KEETA';
}

/** Repasse recebido de um app: baixa das vendas pagas no app (e da comissão e taxa descontadas) até a data. */
export class PayoutDto {
  /** Vendas com repasse previsto até este dia. */
  @IsOptional() @Matches(DATE, DATE_MSG) until?: string;
  /** Dia em que o dinheiro caiu na conta. */
  @IsOptional() @Matches(DATE, DATE_MSG) paidAt?: string;
}

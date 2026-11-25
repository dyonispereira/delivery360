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

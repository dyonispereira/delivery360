import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  type ValidationOptions,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Imagem: link completo (https://...) ou arquivo do próprio site (/vitrine/...), como as fotos da loja modelo. */
const IsImageUrl = (opts?: ValidationOptions) =>
  Matches(/^(https?:\/\/[\w-]+(\.[\w-]+)*(:\d+)?(\/[^\s"'()<>\\]*)?|\/(?!\/)[\w\-./]+)$/, { message: 'Informe o link da imagem (https://...).', ...opts });

export const PAYMENT_METHODS = ['PIX', 'CREDIT_CARD', 'CASH_ON_DELIVERY', 'CARD_ON_DELIVERY'] as const;
/** Código PDV: letras, números, ponto, hífen e sublinhado (vazio apaga). */
const PDV = /^[A-Za-z0-9._-]{0,40}$/;
const PDV_MSG = { message: 'Código PDV: use até 40 letras, números, ponto, hífen ou sublinhado.' };
const MAX_CENTS = 10_000_000; // R$ 100 mil
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class UpdateStoreDto {
  @IsOptional() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'Link da loja: use só letras minúsculas, números e hífen (ex.: pizzaria-do-ze).' }) @MinLength(3, { message: 'Link da loja: use pelo menos 3 caracteres.' }) @MaxLength(60, { message: 'Link da loja: use no máximo 60 caracteres.' })
  slug?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) displayName?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsImageUrl() logoUrl?: string;
  @IsOptional() @IsImageUrl() coverUrl?: string;
  @IsOptional() @Matches(/^\d{10,13}$/, { message: 'WhatsApp: só números, com DDD.' }) whatsapp?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsBoolean() isOpen?: boolean;
  @IsOptional() @IsBoolean() acceptsDelivery?: boolean;
  @IsOptional() @IsBoolean() acceptsPickup?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) minOrderCents?: number;
  @IsOptional() @IsArray() @IsIn(PAYMENT_METHODS, { each: true }) paymentMethods?: (typeof PAYMENT_METHODS)[number][];
  @IsOptional() @IsInt() @Min(5) @Max(240) estimatedMinutes?: number;
  // Pedido agendado
  @IsOptional() @IsBoolean() schedulingEnabled?: boolean;
  @IsOptional() @Matches(HHMM, { message: 'Horário: use HH:MM (ex.: 18:00).' }) scheduleOpensAt?: string;
  @IsOptional() @Matches(HHMM, { message: 'Horário: use HH:MM (ex.: 23:00).' }) scheduleClosesAt?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) scheduleWeekdays?: number[];
  @IsOptional() @IsInt() @Min(0) @Max(48 * 60) scheduleLeadMinutes?: number;
  @IsOptional() @IsInt() @Min(0, { message: 'Dias à frente: de 0 a 30.' }) @Max(30, { message: 'Dias à frente: de 0 a 30.' }) scheduleMaxDays?: number;
  @IsOptional() @IsIn([15, 20, 30, 60], { message: 'Intervalo: 15, 20, 30 ou 60 minutos.' }) scheduleSlotMinutes?: number;
  /** Impressoras térmicas: papel de 58 ou 80 mm. */
  @IsOptional() @IsIn([58, 80], { message: 'Papel: 58 ou 80 mm.' }) receiptWidthMm?: number;
  @IsOptional() @IsIn([58, 80], { message: 'Papel: 58 ou 80 mm.' }) kitchenWidthMm?: number;
  @IsOptional() @IsBoolean() receiptAutoPrint?: boolean;
  @IsOptional() @IsInt() @Min(1, { message: 'Vias: de 1 a 3.' }) @Max(3, { message: 'Vias: de 1 a 3.' }) receiptCopies?: number;
  @IsOptional() @IsString() @MaxLength(200) receiptFooter?: string;
}

export class ZoneDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsInt() @Min(0) @Max(MAX_CENTS) feeCents: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
export class UpdateZoneDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) feeCents?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class CategoryDto {
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  @IsOptional() @IsInt() position?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
export class UpdateCategoryDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsInt() position?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class CostItemDto {
  @IsString() @MinLength(1, { message: 'Dê um nome a cada item da ficha técnica.' }) @MaxLength(80) name: string;
  @IsIn(['INGREDIENT', 'PACKAGING', 'OTHER']) kind: 'INGREDIENT' | 'PACKAGING' | 'OTHER';
  @IsInt() @Min(0) @Max(MAX_CENTS) costCents: number;
}

/** Preço em cada app, em centavos. Sem valor = mesmo preço da loja. */
export class ChannelPricesDto {
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) IFOOD?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) FOOD99?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) KEETA?: number;
}

export class ProductDto {
  @IsUUID() categoryId: string;
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsInt() @Min(0) @Max(MAX_CENTS) priceCents: number;
  @IsOptional() @IsImageUrl() imageUrl?: string;
  @IsOptional() @IsInt() position?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() available?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => CostItemDto) costItems?: CostItemDto[];
  /** Outras despesas variáveis do produto, em pontos-base (100 = 1%). */
  @IsOptional() @IsInt() @Min(0) @Max(5000) extraCostBps?: number;
  @IsOptional() @IsString() @Matches(PDV, PDV_MSG) pdvCode?: string;
  /** Nota fiscal: NCM (8 números) e CFOP (4 números). Vazio = o padrão da loja. */
  @IsOptional() @Matches(/^(\d{8})?$/, { message: 'NCM: 8 números (ex.: 21069090), ou deixe vazio para usar o padrão.' }) ncm?: string;
  @IsOptional() @Matches(/^([5-7]\d{3})?$/, { message: 'CFOP: 4 números começando com 5, 6 ou 7 (ex.: 5102).' }) cfop?: string;
  @IsOptional() @ValidateNested() @Type(() => ChannelPricesDto) channelPrices?: ChannelPricesDto;
  /** Preço de/por (null tira a promoção). */
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) promoPriceCents?: number | null;
  @IsOptional() @IsISO8601({}, { message: 'Início da promoção: data inválida.' }) promoStartsAt?: string | null;
  @IsOptional() @IsISO8601({}, { message: 'Fim da promoção: data inválida.' }) promoEndsAt?: string | null;
}
export class UpdateProductDto {
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) priceCents?: number;
  @IsOptional() @IsImageUrl() imageUrl?: string;
  @IsOptional() @IsInt() position?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() available?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => CostItemDto) costItems?: CostItemDto[];
  @IsOptional() @IsInt() @Min(0) @Max(5000) extraCostBps?: number;
  @IsOptional() @IsString() @Matches(PDV, PDV_MSG) pdvCode?: string;
  /** Nota fiscal: NCM (8 números) e CFOP (4 números). Vazio = o padrão da loja. */
  @IsOptional() @Matches(/^(\d{8})?$/, { message: 'NCM: 8 números (ex.: 21069090), ou deixe vazio para usar o padrão.' }) ncm?: string;
  @IsOptional() @Matches(/^([5-7]\d{3})?$/, { message: 'CFOP: 4 números começando com 5, 6 ou 7 (ex.: 5102).' }) cfop?: string;
  @IsOptional() @ValidateNested() @Type(() => ChannelPricesDto) channelPrices?: ChannelPricesDto;
  /** Preço de/por (null tira a promoção). */
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) promoPriceCents?: number | null;
  @IsOptional() @IsISO8601({}, { message: 'Início da promoção: data inválida.' }) promoStartsAt?: string | null;
  @IsOptional() @IsISO8601({}, { message: 'Fim da promoção: data inválida.' }) promoEndsAt?: string | null;
}

export class OptionGroupDto {
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  @IsInt() @Min(0) @Max(50) minSelect: number;
  @IsInt() @Min(1) @Max(50) maxSelect: number;
  @IsOptional() @IsInt() position?: number;
}
export class UpdateOptionGroupDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(50) minSelect?: number;
  @IsOptional() @IsInt() @Min(1) @Max(50) maxSelect?: number;
  @IsOptional() @IsInt() position?: number;
}

export class OptionDto {
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  @IsInt() @Min(0) @Max(MAX_CENTS) priceCents: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) costCents?: number;
  @IsOptional() @IsString() @Matches(PDV, PDV_MSG) pdvCode?: string;
  @IsOptional() @IsBoolean() available?: boolean;
  @IsOptional() @IsInt() position?: number;
}
export class UpdateOptionDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) priceCents?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) costCents?: number;
  @IsOptional() @IsString() @Matches(PDV, PDV_MSG) pdvCode?: string;
  @IsOptional() @IsBoolean() available?: boolean;
  @IsOptional() @IsInt() position?: number;
}

// ---------- Pedido público (loja online) ----------

export class OrderItemInputDto {
  @IsUUID() productId: string;
  @IsInt() @Min(1) @Max(50) quantity: number;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) optionIds?: string[];
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

export class CustomerInputDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsString() @MaxLength(20) phone: string;
  /** CPF ou CNPJ: exigido pelo Asaas para o Pix. */
  @IsOptional() @IsString() @MaxLength(20) document?: string;
}

export class AddressInputDto {
  @IsUUID() zoneId: string;
  @IsString() @MinLength(2) @MaxLength(120) street: string;
  @IsString() @MinLength(1) @MaxLength(20) number: string;
  @IsOptional() @IsString() @MaxLength(80) complement?: string;
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
}

export class CreateOrderDto {
  @IsIn(['DELIVERY', 'PICKUP']) type: 'DELIVERY' | 'PICKUP';
  @ValidateNested() @Type(() => CustomerInputDto) customer: CustomerInputDto;
  @IsOptional() @ValidateNested() @Type(() => AddressInputDto) address?: AddressInputDto;
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => OrderItemInputDto) items: OrderItemInputDto[];
  @IsIn(PAYMENT_METHODS) paymentMethod: (typeof PAYMENT_METHODS)[number];
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) changeForCents?: number;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsString() @MaxLength(100) utmSource?: string;
  @IsOptional() @IsString() @MaxLength(100) utmCampaign?: string;
  @IsOptional() @IsString() @MaxLength(40) couponCode?: string;
  /** Pedido agendado: horário escolhido (ISO). Vazio = o quanto antes. */
  @IsOptional() @IsISO8601() scheduledFor?: string;
  /** Prêmio da fidelidade trocado por pontos. */
  @IsOptional() @IsUUID() rewardId?: string;
  /** Indique e Ganhe: código de quem indicou (vem do link ?indicacao=). */
  @IsOptional() @IsString() @MaxLength(20) referralCode?: string;
}

/** Prévia da conta no carrinho (sem criar pedido). */
export class QuoteOrderDto {
  @IsIn(['DELIVERY', 'PICKUP']) type: 'DELIVERY' | 'PICKUP';
  @IsOptional() @IsUUID() zoneId?: string;
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => OrderItemInputDto) items: OrderItemInputDto[];
  @IsOptional() @IsIn(PAYMENT_METHODS) paymentMethod?: (typeof PAYMENT_METHODS)[number];
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsString() @MaxLength(40) couponCode?: string;
  @IsOptional() @IsUUID() rewardId?: string;
  @IsOptional() @IsString() @MaxLength(20) referralCode?: string;
  @IsOptional() @IsISO8601() scheduledFor?: string;
}

export class UpdateOrderStatusDto {
  @IsIn(['IN_PREPARATION', 'READY', 'OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED'])
  status: 'IN_PREPARATION' | 'READY' | 'OUT_FOR_DELIVERY' | 'COMPLETED' | 'CANCELLED';
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

export class RateOrderDto {
  @IsInt() @Min(1, { message: 'Escolha de 1 a 5 estrelas.' }) @Max(5, { message: 'Escolha de 1 a 5 estrelas.' }) store: number;
  @IsOptional() @IsInt() @Min(1, { message: 'Escolha de 1 a 5 estrelas.' }) @Max(5, { message: 'Escolha de 1 a 5 estrelas.' }) delivery?: number;
  @IsOptional() @IsString() @MaxLength(500) comment?: string;
}

export class TipDto {
  /** De R$ 1 a R$ 200. */
  @IsInt() @Min(100, { message: 'A gorjeta mínima é R$ 1,00.' }) @Max(20_000, { message: 'A gorjeta máxima é R$ 200,00.' }) amountCents: number;
  /** CPF de quem paga (quando a loja usa Asaas e o pedido ainda não tem). */
  @IsOptional() @IsString() @MaxLength(20) document?: string;
}

/**
 * Cartão digitado no checkout da loja (checkout transparente). Vai direto para o gateway: nada disto é gravado.
 * As mensagens de erro não repetem o valor enviado.
 */
export class PayCardDto {
  @IsString() @MinLength(3, { message: 'Informe o nome impresso no cartão.' }) @MaxLength(80) holderName: string;
  @IsString() @Matches(/^[\d ]{13,23}$/, { message: 'Número do cartão inválido.' }) number: string;
  @IsString() @Matches(/^(0?[1-9]|1[0-2])$/, { message: 'Mês de validade inválido.' }) expiryMonth: string;
  @IsString() @Matches(/^(\d{2}|\d{4})$/, { message: 'Ano de validade inválido.' }) expiryYear: string;
  @IsString() @Matches(/^\d{3,4}$/, { message: 'Código de segurança (CVV) inválido.' }) ccv: string;
  /** CPF/CNPJ do titular do cartão (se vazio, usa o do pedido). */
  @IsOptional() @IsString() @MaxLength(20) document?: string;
  @IsString() @Matches(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'Informe um e-mail válido.' }) @MaxLength(120) email: string;
  @IsString() @Matches(/^\d{5}-?\d{3}$/, { message: 'Informe um CEP válido.' }) postalCode: string;
  @IsString() @MinLength(1, { message: 'Informe o número do endereço.' }) @MaxLength(10) addressNumber: string;
}

// ---------- Canais de venda (iFood, 99Food, Keeta) ----------

export const MARKETPLACE_CODES = ['IFOOD', 'FOOD99', 'KEETA'] as const;
export type MarketplaceCode = (typeof MARKETPLACE_CODES)[number];

export class ChannelSettingDto {
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MaxLength(80) merchantId?: string;
  /** Comissão do app, em pontos-base (100 = 1%). */
  @IsOptional() @IsInt() @Min(0) @Max(5000) commissionBps?: number;
  @IsOptional() @IsInt() @Min(0) @Max(2000) paymentFeeBps?: number;
  @IsOptional() @IsInt() @Min(0) @Max(120) payoutDays?: number;
}

export class ChannelOrderOptionDto {
  @IsOptional() @IsString() @MaxLength(40) pdvCode?: string;
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(80) groupName?: string;
  /** Preço de uma unidade do adicional no app. */
  @IsInt() @Min(0) @Max(MAX_CENTS) priceCents: number;
  @IsOptional() @IsInt() @Min(1) @Max(50) quantity?: number;
}

export class ChannelOrderItemDto {
  /** Código PDV cadastrado no app: liga o item ao produto do cardápio (mesmo produto em todos os canais). */
  @IsOptional() @IsString() @MaxLength(40) pdvCode?: string;
  @IsString() @MinLength(1) @MaxLength(160) name: string;
  @IsInt() @Min(1) @Max(100) quantity: number;
  /** Preço de uma unidade no app, sem os adicionais. */
  @IsInt() @Min(0) @Max(MAX_CENTS) unitPriceCents: number;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ChannelOrderOptionDto) options?: ChannelOrderOptionDto[];
}

export class ChannelAddressDto {
  @IsString() @MinLength(2) @MaxLength(160) street: string;
  @IsString() @MinLength(1) @MaxLength(20) number: string;
  @IsOptional() @IsString() @MaxLength(80) complement?: string;
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
  @IsOptional() @IsString() @MaxLength(80) neighborhood?: string;
}

/**
 * Pedido de app de delivery no formato único do sistema. Cada integração (iFood, 99Food, Keeta)
 * converte o pedido do app para este formato; o resto (cozinha, entregas, financeiro) é igual.
 */
export class ChannelOrderDto {
  @IsIn(MARKETPLACE_CODES) channel: MarketplaceCode;
  @IsString() @MinLength(1) @MaxLength(80) externalId: string;
  @IsOptional() @IsString() @MaxLength(20) externalCode?: string;
  @IsIn(['DELIVERY', 'PICKUP']) type: 'DELIVERY' | 'PICKUP';
  @ValidateNested() @Type(() => CustomerInputDto) customer: CustomerInputDto;
  @IsOptional() @ValidateNested() @Type(() => ChannelAddressDto) address?: ChannelAddressDto;
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ChannelOrderItemDto) items: ChannelOrderItemDto[];
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) deliveryFeeCents?: number;
  /** Desconto bancado pelo restaurante (cupom da loja). */
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) discountCents?: number;
  @IsIn(['APP_ONLINE', 'CASH_ON_DELIVERY', 'CARD_ON_DELIVERY']) paymentMethod: 'APP_ONLINE' | 'CASH_ON_DELIVERY' | 'CARD_ON_DELIVERY';
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) changeForCents?: number;
  /** Código de entrega que o app mostra ao cliente (4 dígitos). */
  @IsOptional() @Matches(/^\d{4}$/, { message: 'Código de entrega: 4 números.' }) deliveryCode?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

// ---------- Cupons da loja própria ----------

const COUPON_CODE = /^[A-Za-z0-9_-]{3,20}$/;

export class CouponDto {
  /** Obrigatório no cupom do restaurante; no impulso Delivery360 é gerado. */
  @IsOptional() @IsString() @Matches(COUPON_CODE, { message: 'Código: de 3 a 20 letras ou números, sem espaços.' }) code?: string;
  @IsOptional() @IsString() @MaxLength(120) description?: string;
  @IsIn(['PERCENT', 'FIXED', 'FREE_DELIVERY']) type: 'PERCENT' | 'FIXED' | 'FREE_DELIVERY';
  /** PERCENT: pontos-base (1000 = 10%). FIXED: centavos. */
  @IsInt() @Min(0) @Max(MAX_CENTS) value: number;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_CENTS) maxDiscountCents?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) minOrderCents?: number;
  @IsOptional() @IsISO8601() startsAt?: string | null;
  @IsOptional() @IsISO8601() endsAt?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) weekdays?: number[];
  @IsOptional() @IsInt() @Min(1) @Max(1_000_000) maxUses?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(1000) maxUsesPerCustomer?: number | null;
  @IsOptional() @IsBoolean() firstOrderOnly?: boolean;
  @IsOptional() @IsBoolean() combinesWithPromo?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) productIds?: string[];
  @IsOptional() @IsBoolean() public?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateCouponDto {
  @IsOptional() @IsString() @Matches(COUPON_CODE, { message: 'Código: de 3 a 20 letras ou números, sem espaços.' }) code?: string;
  @IsOptional() @IsString() @MaxLength(120) description?: string;
  @IsOptional() @IsIn(['PERCENT', 'FIXED', 'FREE_DELIVERY']) type?: 'PERCENT' | 'FIXED' | 'FREE_DELIVERY';
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) value?: number;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_CENTS) maxDiscountCents?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) minOrderCents?: number;
  @IsOptional() @IsISO8601() startsAt?: string | null;
  @IsOptional() @IsISO8601() endsAt?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) weekdays?: number[];
  @IsOptional() @IsInt() @Min(1) @Max(1_000_000) maxUses?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(1000) maxUsesPerCustomer?: number | null;
  @IsOptional() @IsBoolean() firstOrderOnly?: boolean;
  @IsOptional() @IsBoolean() combinesWithPromo?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) productIds?: string[];
  @IsOptional() @IsBoolean() public?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}

// ---------- Combos ----------

export class ComboOptionDto {
  /** Opção já existente (na edição). */
  @IsOptional() @IsUUID() id?: string;
  /** Produto do cardápio que entra no combo. Sem ele, é um item só do combo (informe o nome). */
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  /** Acréscimo no preço do combo ao escolher esta opção (ex.: borda recheada +R$ 8). */
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) priceCents?: number;
  /** Custo de um item só do combo (o de produto do cardápio vem da ficha técnica dele). */
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) costCents?: number;
}

export class ComboStepDto {
  @IsOptional() @IsUUID() id?: string;
  /** "Escolha a pizza", "Bebida", "Inclui". */
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  @IsInt() @Min(0) @Max(20) minSelect: number;
  @IsInt() @Min(1) @Max(20) maxSelect: number;
  @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => ComboOptionDto) options: ComboOptionDto[];
}

export class ComboDto {
  @IsUUID() categoryId: string;
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsImageUrl() imageUrl?: string;
  @IsInt() @Min(1) @Max(MAX_CENTS) priceCents: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => ComboStepDto) steps: ComboStepDto[];
}

// ---------- Campanhas da rede (equipe Delivery360) ----------

export class CampaignDto {
  @IsString() @MaxLength(60) title: string;
  @IsOptional() @IsString() @MaxLength(120) subtitle?: string | null;
  @IsImageUrl({ message: 'Informe o link da imagem do banner (https://...).' }) imageUrl: string;
  /** Lojas da campanha. Vazio = todas. */
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true }) tenantIds?: string[];
  @IsOptional() @IsISO8601() startsAt?: string | null;
  @IsOptional() @IsISO8601() endsAt?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(1000) position?: number;
  /** A arte já tem o texto: a loja mostra a imagem inteira, sem título por cima. */
  @IsOptional() @IsBoolean() fullArt?: boolean;
  /** Sem código = só banner. */
  @IsOptional() @IsString() @Matches(COUPON_CODE, { message: 'Código: de 3 a 20 letras ou números, sem espaços.' }) couponCode?: string | null;
  @IsOptional() @IsIn(['PERCENT', 'FIXED', 'FREE_DELIVERY']) type?: 'PERCENT' | 'FIXED' | 'FREE_DELIVERY';
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) value?: number;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_CENTS) maxDiscountCents?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) minOrderCents?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) weekdays?: number[];
  @IsOptional() @IsInt() @Min(1) @Max(1_000_000) maxUses?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(1000) maxUsesPerCustomer?: number | null;
  @IsOptional() @IsBoolean() firstOrderOnly?: boolean;
  @IsOptional() @IsBoolean() combinesWithPromo?: boolean;
  /** Parte do desconto bancada pela Delivery360 (10000 = 100%; 0 = tudo do restaurante). */
  @IsOptional() @IsInt() @Min(0) @Max(10_000) platformShareBps?: number;
}

export class CampaignParticipationDto {
  @IsBoolean() participating: boolean;
}

// ---------- Salão (mesas e conta da mesa) ----------

export class TableDto {
  @IsString() @MinLength(1) @MaxLength(40) name: string;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) position?: number;
}

export class UpdateTableDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(40) name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) position?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

/** Cria várias mesas de uma vez: "Mesa 1" até "Mesa N" (as que já existem ficam como estão). */
export class BulkTablesDto {
  @IsInt() @Min(1) @Max(200) count: number;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(20) prefix?: string;
}

export class TabItemDto {
  @IsUUID() productId: string;
  @IsInt() @Min(1) @Max(50) quantity: number;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) optionIds?: string[];
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

/** Uma rodada lançada pelo garçom: vai direto para a cozinha e soma na conta da mesa. */
export class TableOrderDto {
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => TabItemDto) items: TabItemDto[];
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
  @IsOptional() @IsInt() @Min(1) @Max(99) people?: number;
}

const TAB_METHODS = ['PIX', 'CASH_ON_DELIVERY', 'CARD_ON_DELIVERY'] as const;
type TabMethod = (typeof TAB_METHODS)[number];

export class CloseTabDto {
  /** Atalho: sem pagamentos ainda, registra o total de uma vez nesta forma. */
  @IsOptional() @IsIn(TAB_METHODS) paymentMethod?: TabMethod;
  /** Cobrar a taxa de serviço da loja (o cliente pode recusar). */
  @IsOptional() @IsBoolean() serviceFee?: boolean;
}

/** Um pagamento da conta da mesa (um cartão, um Pix, dinheiro). */
export class TabPaymentDto {
  @IsIn(TAB_METHODS) method: TabMethod;
  @IsInt() @Min(1) @Max(MAX_CENTS) amountCents: number;
  @IsOptional() @IsString() @MaxLength(40) label?: string;
}

export class UpdateTabDto {
  @IsBoolean() serviceFee: boolean;
}

export class ServiceFeeDto {
  @IsInt() @Min(0) @Max(2000) serviceFeeBps: number;
}

// ---------- Fidelidade ----------

export class LoyaltyProgramDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(1, { message: 'Dê pelo menos 1 ponto por real.' }) @Max(100) pointsPerReal?: number;
  @IsOptional() @IsInt() @Min(0) @Max(3650) expireDays?: number;
  @IsOptional() @IsBoolean() clubEnabled?: boolean;
  @IsOptional() @IsBoolean() referralEnabled?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) referralFriendCents?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) referralMinOrderCents?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) referralReferrerPoints?: number;
}

export class LoyaltyRewardDto {
  @IsString() @MinLength(2, { message: 'Dê um nome ao prêmio.' }) @MaxLength(80) name: string;
  @IsInt() @Min(1, { message: 'O prêmio precisa custar pelo menos 1 ponto.' }) @Max(1_000_000) pointsCost: number;
  @IsIn(['FIXED', 'FREE_DELIVERY', 'PRODUCT']) type: 'FIXED' | 'FREE_DELIVERY' | 'PRODUCT';
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) valueCents?: number;
  @IsOptional() @IsUUID() productId?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) minOrderCents?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class ClubLevelDto {
  @IsString() @MinLength(2, { message: 'Dê um nome ao nível.' }) @MaxLength(40) name: string;
  @IsInt() @Min(0) @Max(10_000_000) minPoints: number;
  /** Pontos-base: 500 = 5%. Até 50%. */
  @IsOptional() @IsInt() @Min(0) @Max(5000, { message: 'O desconto do nível vai até 50%.' }) discountBps?: number;
  @IsOptional() @IsBoolean() freeDelivery?: boolean;
}

export class LoyaltyAdjustDto {
  @IsInt() @Min(-1_000_000) @Max(1_000_000) points: number;
  @IsString() @MinLength(2, { message: 'Diga o motivo do ajuste.' }) @MaxLength(120) note: string;
}

// ---------- PDV (balcão), caixa e nota fiscal ----------

export class OpenCashDto {
  @IsInt() @Min(0) @Max(MAX_CENTS) openingCents: number;
}

export class CashMovementDto {
  @IsIn(['SANGRIA', 'SUPRIMENTO']) kind: 'SANGRIA' | 'SUPRIMENTO';
  @IsInt() @Min(1, { message: 'Informe o valor.' }) @Max(MAX_CENTS) amountCents: number;
  @IsOptional() @IsString() @MaxLength(120) reason?: string;
}

export class CloseCashDto {
  /** Quanto tem de dinheiro na gaveta, contado na hora. */
  @IsInt() @Min(0) @Max(MAX_CENTS) countedCents: number;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

export class PdvPaymentDto {
  @IsIn(['CASH', 'PIX', 'DEBIT', 'CREDIT']) key: 'CASH' | 'PIX' | 'DEBIT' | 'CREDIT';
  @IsInt() @Min(1) @Max(MAX_CENTS) amountCents: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) receivedCents?: number;
}

export class PdvSaleDto {
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => TabItemDto) items: TabItemDto[];
  @IsArray() @ArrayMaxSize(6) @ValidateNested({ each: true }) @Type(() => PdvPaymentDto) payments: PdvPaymentDto[];
  @IsOptional() @IsString() @MaxLength(60) customerName?: string;
  /** CPF ou CNPJ na nota. */
  @IsOptional() @IsString() @MaxLength(20) document?: string;
  /** Desconto dado no balcão, em centavos. */
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) discountCents?: number;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
  /** Mandar para a cozinha (lanche feito na hora) ou entregar na hora (bebida, sobremesa pronta). */
  @IsBoolean() kitchen: boolean;
  /** Cupom não fiscal ou NFC-e. */
  @IsIn(['NAO_FISCAL', 'NFCE']) receipt: 'NAO_FISCAL' | 'NFCE';
}

export class CancelSaleDto {
  @IsString() @MinLength(15, { message: 'Explique o motivo com pelo menos 15 letras (vai para a SEFAZ se tiver nota).' }) @MaxLength(255) reason: string;
}

export class EmitNfceDto {
  @IsOptional() @IsString() @MaxLength(20) document?: string;
}

export class FiscalSettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsIn(['HOMOLOGACAO', 'PRODUCAO']) environment?: 'HOMOLOGACAO' | 'PRODUCAO';
  @IsOptional() @Matches(/^\d{14}$/, { message: 'CNPJ: 14 números.' }) cnpj?: string;
  @IsOptional() @Matches(/^(\d{2,14}|ISENTO)$/, { message: 'Inscrição estadual: só números (ou ISENTO).' }) stateRegistration?: string;
  @IsOptional() @IsString() @MaxLength(120) legalName?: string;
  @IsOptional() @IsIn(['RO', 'AC', 'AM', 'RR', 'PA', 'AP', 'TO', 'MA', 'PI', 'CE', 'RN', 'PB', 'PE', 'AL', 'SE', 'BA', 'MG', 'ES', 'RJ', 'SP', 'PR', 'SC', 'RS', 'MS', 'MT', 'GO', 'DF'], { message: 'UF inválida.' }) uf?: string;
  @IsOptional() @IsIn([1, 2, 3]) taxRegime?: number;
  @IsOptional() @Matches(/^\d{1,6}$/, { message: 'ID do CSC: só números (ex.: 000001).' }) cscId?: string;
  /** Token do CSC (só se for trocar; guardado cifrado). */
  @IsOptional() @IsString() @MinLength(16, { message: 'O CSC tem de 16 a 36 caracteres.' }) @MaxLength(36) cscToken?: string;
  @IsOptional() @IsInt() @Min(1) @Max(999) series?: number;
  @IsOptional() @IsInt() @Min(1) @Max(999_999_999) nextNumber?: number;
  @IsOptional() @Matches(/^\d{8}$/, { message: 'NCM: 8 números.' }) defaultNcm?: string;
  @IsOptional() @Matches(/^[5-7]\d{3}$/, { message: 'CFOP: 4 números (ex.: 5102).' }) defaultCfop?: string;
  @IsOptional() @Matches(/^\d{2,3}$/, { message: 'CSOSN/CST: 2 ou 3 números (ex.: 102).' }) defaultCsosn?: string;
  @IsOptional() @IsIn(['NAO_FISCAL', 'NFCE']) pdvReceipt?: 'NAO_FISCAL' | 'NFCE';
}

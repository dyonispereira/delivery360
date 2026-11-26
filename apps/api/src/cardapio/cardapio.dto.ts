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
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const PAYMENT_METHODS = ['PIX', 'CREDIT_CARD', 'CASH_ON_DELIVERY', 'CARD_ON_DELIVERY'] as const;
/** Código PDV: letras, números, ponto, hífen e sublinhado (vazio apaga). */
const PDV = /^[A-Za-z0-9._-]{0,40}$/;
const PDV_MSG = { message: 'Código PDV: use até 40 letras, números, ponto, hífen ou sublinhado.' };
const MAX_CENTS = 10_000_000; // R$ 100 mil

export class UpdateStoreDto {
  @IsOptional() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'Link da loja: use só letras minúsculas, números e hífen (ex.: pizzaria-do-ze).' }) @MinLength(3, { message: 'Link da loja: use pelo menos 3 caracteres.' }) @MaxLength(60, { message: 'Link da loja: use no máximo 60 caracteres.' })
  slug?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) displayName?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) logoUrl?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) coverUrl?: string;
  @IsOptional() @Matches(/^\d{10,13}$/, { message: 'WhatsApp: só números, com DDD.' }) whatsapp?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsBoolean() isOpen?: boolean;
  @IsOptional() @IsBoolean() acceptsDelivery?: boolean;
  @IsOptional() @IsBoolean() acceptsPickup?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) minOrderCents?: number;
  @IsOptional() @IsArray() @IsIn(PAYMENT_METHODS, { each: true }) paymentMethods?: (typeof PAYMENT_METHODS)[number][];
  @IsOptional() @IsInt() @Min(5) @Max(240) estimatedMinutes?: number;
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
  @IsOptional() @IsUrl({ require_protocol: true }) imageUrl?: string;
  @IsOptional() @IsInt() position?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() available?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => CostItemDto) costItems?: CostItemDto[];
  /** Outras despesas variáveis do produto, em pontos-base (100 = 1%). */
  @IsOptional() @IsInt() @Min(0) @Max(5000) extraCostBps?: number;
  @IsOptional() @IsString() @Matches(PDV, PDV_MSG) pdvCode?: string;
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
  @IsOptional() @IsUrl({ require_protocol: true }) imageUrl?: string;
  @IsOptional() @IsInt() position?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() available?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => CostItemDto) costItems?: CostItemDto[];
  @IsOptional() @IsInt() @Min(0) @Max(5000) extraCostBps?: number;
  @IsOptional() @IsString() @Matches(PDV, PDV_MSG) pdvCode?: string;
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
}

/** Prévia da conta no carrinho (sem criar pedido). */
export class QuoteOrderDto {
  @IsIn(['DELIVERY', 'PICKUP']) type: 'DELIVERY' | 'PICKUP';
  @IsOptional() @IsUUID() zoneId?: string;
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => OrderItemInputDto) items: OrderItemInputDto[];
  @IsOptional() @IsIn(PAYMENT_METHODS) paymentMethod?: (typeof PAYMENT_METHODS)[number];
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsString() @MaxLength(40) couponCode?: string;
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
  @IsOptional() @IsUrl({ require_protocol: true }) imageUrl?: string;
  @IsInt() @Min(1) @Max(MAX_CENTS) priceCents: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => ComboStepDto) steps: ComboStepDto[];
}

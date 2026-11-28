import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentTenant, CurrentUser, RequireModule, TenantRoles } from '../access/access.decorators';
import type { AuthUser, TenantContext } from '../access/access.types';
import { FiscalService } from '../fiscal/fiscal.service';
import { receiptPdf } from '../fiscal/receipt-pdf';
import { CancelSaleDto, CashMovementDto, CloseCashDto, EmitNfceDto, FiscalSettingsDto, OpenCashDto, PdvSaleDto } from './cardapio.dto';
import { PdvService } from './pdv.service';

const UUID = new ParseUUIDPipe();

/**
 * PDV de balcão e caixa: dono, gerente e funcionários. Cancelar venda e mudar dados fiscais: dono e gerente.
 * O cupom (não fiscal ou NFC-e) sai em JSON (para a impressora térmica) ou em PDF.
 */
@RequireModule('cardapio')
@Controller('cardapio/pdv')
export class PdvController {
  constructor(
    private readonly pdv: PdvService,
    private readonly fiscal: FiscalService,
  ) {}

  @Get('caixa')
  async current(@CurrentTenant() t: TenantContext) {
    const [session, fiscal] = await Promise.all([this.pdv.current(t.tenantId), this.fiscal.settings(t.tenantId)]);
    return { session, nfce: { available: fiscal.enabled && fiscal.missing.length === 0, defaultReceipt: fiscal.pdvReceipt, environment: fiscal.environment } };
  }

  @Post('caixa/abrir')
  open(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body() dto: OpenCashDto) {
    return this.pdv.open(t.tenantId, u.id, dto);
  }

  @Post('caixa/movimento')
  movement(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body() dto: CashMovementDto) {
    return this.pdv.movement(t.tenantId, u.id, dto);
  }

  @Post('caixa/fechar')
  close(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body() dto: CloseCashDto) {
    return this.pdv.close(t.tenantId, u.id, dto);
  }

  @Get('caixas')
  history(@CurrentTenant() t: TenantContext) {
    return this.pdv.history(t.tenantId);
  }

  @Get('caixas/:id')
  session(@CurrentTenant() t: TenantContext, @Param('id', UUID) id: string) {
    return this.pdv.session(t.tenantId, id);
  }

  @Post('vendas')
  sale(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body() dto: PdvSaleDto) {
    return this.pdv.sale(t.tenantId, u.id, dto);
  }

  @Get('vendas')
  sales(@CurrentTenant() t: TenantContext, @Query('caixa') caixa?: string) {
    return this.pdv.sales(t.tenantId, caixa && /^[0-9a-f-]{36}$/i.test(caixa) ? caixa : undefined);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Post('vendas/:id/cancelar')
  cancel(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() dto: CancelSaleDto) {
    return this.pdv.cancelSale(t.tenantId, u.id, id, dto.reason);
  }

  // ---------- Cupom e NFC-e (vale para qualquer pedido da loja) ----------

  @Get('pedidos/:id/cupom')
  receipt(@CurrentTenant() t: TenantContext, @Param('id', UUID) id: string, @Query('tipo') tipo?: string) {
    return this.fiscal.receipt(t.tenantId, id, tipo === 'NFCE' || tipo === 'NAO_FISCAL' ? tipo : undefined);
  }

  @Get('pedidos/:id/cupom.pdf')
  async receiptPdf(@CurrentTenant() t: TenantContext, @Param('id', UUID) id: string, @Res() res: Response, @Query('tipo') tipo?: string) {
    const r = await this.fiscal.receipt(t.tenantId, id, tipo === 'NFCE' || tipo === 'NAO_FISCAL' ? tipo : undefined);
    const pdf = await receiptPdf(r);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${r.kind === 'NFCE' ? 'nfce' : 'cupom'}-${r.number}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(pdf);
  }

  @Post('pedidos/:id/nfce')
  async emit(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() dto: EmitNfceDto) {
    const { payload: _p, ...doc } = await this.fiscal.emit(t.tenantId, u.id, id, dto.document);
    return doc;
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Post('pedidos/:id/nfce/cancelar')
  async cancelNfce(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() dto: CancelSaleDto) {
    const doc = await this.fiscal.cancel(t.tenantId, u.id, id, dto.reason);
    return { cancelled: !!doc };
  }

  @Get('notas')
  notes(@CurrentTenant() t: TenantContext) {
    return this.fiscal.list(t.tenantId);
  }

  @Get('fiscal')
  settings(@CurrentTenant() t: TenantContext) {
    return this.fiscal.settings(t.tenantId);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Put('fiscal')
  saveSettings(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body() dto: FiscalSettingsDto) {
    return this.fiscal.updateSettings(t.tenantId, u.id, dto);
  }
}

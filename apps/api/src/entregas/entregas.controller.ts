import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentTenant, CurrentUser, Public, RequireModule, TenantRoles } from '../access/access.decorators';
import type { AuthUser, TenantContext } from '../access/access.types';
import { CourierDto, CreateBatchDto, DeliverDto, LocationDto, UpdateCourierDto } from './entregas.dto';
import { EntregasService } from './entregas.service';

const UUID = new ParseUUIDPipe();

/** Restaurante: motoboys e lotes. Montar lote é do dia a dia (qualquer pessoa da equipe); cadastro é do dono e gerente. */
@RequireModule('entregas')
@Controller('entregas')
export class EntregasManageController {
  constructor(private readonly entregas: EntregasService) {}

  @Get('couriers')
  couriers(@CurrentTenant() t: TenantContext) {
    return this.entregas.listCouriers(t.tenantId);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Post('couriers')
  createCourier(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body() dto: CourierDto) {
    return this.entregas.createCourier(t.tenantId, u.id, dto);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Patch('couriers/:id')
  updateCourier(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() dto: UpdateCourierDto) {
    return this.entregas.updateCourier(t.tenantId, u.id, id, dto);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Post('couriers/:id/new-link')
  @HttpCode(200)
  rotate(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.entregas.rotateToken(t.tenantId, u.id, id);
  }

  @Get('overview')
  overview(@CurrentTenant() t: TenantContext) {
    return this.entregas.overview(t.tenantId);
  }

  @Post('batches')
  createBatch(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body() dto: CreateBatchDto) {
    return this.entregas.createBatch(t.tenantId, u.id, dto);
  }

  @Post('orders/:id/remove-from-batch')
  @HttpCode(200)
  remove(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.entregas.removeFromBatch(t.tenantId, u.id, id);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Post('orders/:id/unlock-code')
  @HttpCode(200)
  unlock(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.entregas.unlockCode(t.tenantId, u.id, id);
  }
}

/** Tela do entregador: sem login, pelo link secreto do motoboy. */
@Public()
@Controller('public/courier')
export class CourierPublicController {
  constructor(private readonly entregas: EntregasService) {}

  @Get(':token')
  view(@Param('token') token: string) {
    return this.entregas.courierView(token);
  }

  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 1000 : 20, ttl: 60_000 } })
  @Post(':token/orders/:id/deliver')
  @HttpCode(200)
  deliver(@Param('token') token: string, @Param('id', UUID) id: string, @Body() dto: DeliverDto) {
    return this.entregas.deliver(token, id, dto.code);
  }

  /** O celular manda a posição a cada ~10 s durante a entrega. */
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 1000 : 30, ttl: 60_000 } })
  @Post(':token/location')
  @HttpCode(200)
  location(@Param('token') token: string, @Body() dto: LocationDto) {
    return this.entregas.updateLocation(token, dto);
  }
}

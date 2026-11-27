import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { IsString } from 'class-validator';
import { CurrentTenant, CurrentUser, Public, RequireModule, StaffOnly, TenantRoles } from '../access/access.decorators';
import { apiBaseUrl, UploadsService } from './uploads.service';

export class UploadDto {
  /** data:image/...;base64,... */
  @IsString() dataUrl!: string;
}

/** Foto enviada pelo dono ou gerente (produto, combo, logo, capa). */
@RequireModule('cardapio')
@Controller('cardapio/uploads')
export class TenantUploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @TenantRoles('OWNER', 'MANAGER')
  @Post()
  upload(@Body() dto: UploadDto, @CurrentTenant() t: { tenantId: string }, @CurrentUser() u: { id: string }, @Req() req: Request) {
    return this.uploads.save(dto.dataUrl, t.tenantId, u.id, apiBaseUrl(req));
  }
}

/** Foto enviada pela equipe Delivery360 (banners de campanha). */
@StaffOnly()
@Controller('admin/uploads')
export class AdminUploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  upload(@Body() dto: UploadDto, @CurrentUser() u: { id: string }, @Req() req: Request) {
    return this.uploads.save(dto.dataUrl, null, u.id, apiBaseUrl(req));
  }
}

/** A loja busca a foto aqui. O conteúdo de um id nunca muda, então o cache pode ser longo. */
@Public()
@SkipThrottle()
@Controller('public/uploads')
export class PublicUploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const up = await this.uploads.get(id);
    res.set({
      'Content-Type': up.mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    });
    res.send(Buffer.from(up.bytes));
  }
}

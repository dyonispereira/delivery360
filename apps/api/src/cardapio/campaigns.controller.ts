import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { CurrentUser, StaffOnly } from '../access/access.decorators';
import type { AuthUser } from '../access/access.types';
import { CampaignDto } from './cardapio.dto';
import { CampaignsService } from './campaigns.service';

/** Campanhas da rede: só a equipe Delivery360 cria, altera e apaga. */
@StaffOnly()
@Controller('admin/campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  list() {
    return this.campaigns.list();
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CampaignDto) {
    return this.campaigns.create(u, dto);
  }

  @Put(':id')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CampaignDto) {
    return this.campaigns.update(u, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.remove(u, id);
  }
}

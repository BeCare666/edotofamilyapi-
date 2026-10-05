import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, SUPER_ADMIN } from '../auth/roles.decorator';
import { CampaignsAdminService } from './campaigns-admin.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function sendFile(res: Response, file: { filename: string; buffer: Buffer }) {
  res.setHeader('Content-Type', XLSX);
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.setHeader('Content-Length', String(file.buffer.length));
  res.end(file.buffer);
}

// Gestion des campagnes et des sponsors : super_admin uniquement
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SUPER_ADMIN)
@Controller('admin')
export class CampaignsAdminController {
  constructor(private readonly admin: CampaignsAdminService) { }

  @Get('sponsors')
  listSponsors() {
    return this.admin.listSponsors();
  }

  @Post('sponsors')
  createSponsor(@Body() body: any) {
    return this.admin.createSponsor(body);
  }

  // ?status=a_venir|en_cours|terminee (sans filtre : toutes)
  // Filtres réels : recherche (titre), ville, sponsor, tri ; « facets » = compteurs
  @Get('campaigns')
  list(@Query() q: any) {
    return this.admin.list({ status: q.status, page: q.page, limit: q.limit, search: q.search, city: q.city, sponsor: q.sponsor, sort: q.sort });
  }

  // Déclarée avant campaigns/:id
  @Get('campaigns/facets')
  facets() {
    return this.admin.facets();
  }

  // Déclarée avant campaigns/:id
  @Get('campaigns/export')
  async exportAll(@Res() res: Response) {
    sendFile(res, await this.admin.exportAll());
  }

  @Get('campaigns/:id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.admin.detail(id);
  }

  @Get('campaigns/:id/export')
  async exportOne(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    sendFile(res, await this.admin.exportCampaign(id));
  }

  @Post('campaigns')
  create(@Body() body: any) {
    return this.admin.create(body);
  }

  @Put('campaigns/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.admin.update(id, body);
  }

  @Delete('campaigns/:id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.admin.remove(id);
  }
}

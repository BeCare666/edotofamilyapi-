import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, SUPER_ADMIN } from '../auth/roles.decorator';
import { SiteAppearanceService } from './site-appearance.service';
import { Public } from '../auth/public.decorator';
import { SetFontDto } from './dto/set-font.dto';

// Police du site et de l'admin : lecture publique, modification réservée au super admin
@Controller()
export class SiteAppearanceController {
  constructor(private readonly service: SiteAppearanceService) {}

  @Public()
  @Get('site-appearance')
  get() {
    return this.service.get();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(SUPER_ADMIN)
  @Put('admin/site-appearance')
  update(@Body() body: SetFontDto, @Req() req: any) {
    return this.service.setFont(body?.font, req.user.id);
  }
}

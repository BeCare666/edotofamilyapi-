import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CreateSettingDto } from './dto/create-setting.dto';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, SUPER_ADMIN } from '../auth/roles.decorator';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  // Chaque enregistrement crée la ligne lue par tout le site (la plus récente) :
  // réservé au super admin (avant : ouvert à tous, sans connexion).
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(SUPER_ADMIN)
  @Post()
  create(@Body() createSettingDto: CreateSettingDto) {
    return this.settingsService.create(createSettingDto);
  }

  @Get()
  findAll() {
    return this.settingsService.findAll();
  }
}

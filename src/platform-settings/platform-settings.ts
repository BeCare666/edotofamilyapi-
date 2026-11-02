import { Body, Controller, Get, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit, Param, Put, Req, UseGuards } from '@nestjs/common';
import { IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.services';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, SUPER_ADMIN } from '../auth/roles.decorator';
import { Public } from '../auth/public.decorator';
import {
  GROUP_LABELS,
  SETTING_DEFS,
  isCustomized,
  loadSettings,
  parseSettingValue,
  setting,
  settingDef,
  settingOn,
} from './platform-settings.store';

// Paramètres avancés (02/11/2026, migration 027) : voir platform-settings.store.ts

@StrictDto()
export class PlatformSettingDto {
  @IsOptional() @IsScalar() value?: string | number | boolean;
}

const current = (key: string) => (settingDef(key).type === 'bool' ? settingOn(key) : setting(key));

@Injectable()
export class PlatformSettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Paramètres');
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly db: DatabaseService) {}

  async onModuleInit() {
    await this.reload();
    // Relecture régulière : prise en compte même si une autre instance a fait la modification
    this.timer = setInterval(() => void this.reload(), 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Table absente (migration 027 non lancée) : valeurs d'origine, sans erreur */
  async reload() {
    try {
      const [rows]: any = await this.db.getPool().query('SELECT setting_key, value FROM platform_settings');
      loadSettings(rows);
    } catch (e: any) {
      if (!/doesn't exist/i.test(String(e?.message))) this.logger.warn(`Lecture des paramètres impossible : ${e?.message}`);
    }
  }

  /** Admin : toutes les règles, groupées, avec la valeur en vigueur et la valeur d'origine */
  async list() {
    await this.reload();
    const [rows]: any = await this.db
      .getPool()
      .query('SELECT setting_key, updated_at FROM platform_settings')
      .catch(() => [[]]);
    const changed = new Map<string, any>((rows || []).map((r: any) => [r.setting_key, r.updated_at]));
    return Object.entries(GROUP_LABELS).map(([group, label]) => ({
      group,
      label,
      settings: SETTING_DEFS.filter((d) => d.group === group).map((d) => ({
        key: d.key,
        label: d.label,
        help: d.help,
        type: d.type,
        unit: d.unit ?? null,
        min: d.min ?? null,
        max: d.max ?? null,
        value: current(d.key),
        default: d.fallback(),
        customized: isCustomized(d.key),
        updated_at: changed.get(d.key) ?? null,
      })),
    }));
  }

  /** Public : seulement les valeurs utiles à l'affichage du site */
  publicValues() {
    const out: Record<string, number | boolean> = {};
    for (const d of SETTING_DEFS) if (d.public) out[d.key] = current(d.key);
    return out;
  }

  async update(key: string, raw: unknown, adminId: number) {
    const def = settingDef(key);
    const value = parseSettingValue(def, raw);
    await this.db.getPool().query(
      `INSERT INTO platform_settings (setting_key, value, updated_at, updated_by) VALUES (?, ?, NOW(), ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW(), updated_by = VALUES(updated_by)`,
      [key, String(value), adminId || null],
    );
    await this.reload();
    return { success: true, message: `${def.label} : enregistré.`, key, value: current(key) };
  }

  /** Retour à la valeur d'origine (ligne supprimée) */
  async reset(key: string) {
    const def = settingDef(key);
    await this.db.getPool().query('DELETE FROM platform_settings WHERE setting_key = ?', [key]);
    await this.reload();
    return { success: true, message: `${def.label} : valeur d'origine rétablie.`, key, value: current(key) };
  }
}

@Controller()
export class PlatformSettingsController {
  constructor(private readonly service: PlatformSettingsService) {}

  @Public()
  @Get('platform-settings')
  publicValues() {
    return this.service.publicValues();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(SUPER_ADMIN)
  @Get('admin/platform-settings')
  list() {
    return this.service.list();
  }

  // :id = clé du paramètre (inscrite au journal d'audit comme identifiant de la ressource)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(SUPER_ADMIN)
  @Put('admin/platform-settings/:id')
  update(@Param('id') key: string, @Body() body: PlatformSettingDto, @Req() req: any) {
    return this.service.update(key, body?.value, Number(req.user?.id));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(SUPER_ADMIN)
  @Put('admin/platform-settings/:id/reset')
  reset(@Param('id') key: string) {
    return this.service.reset(key);
  }
}

@Module({
  imports: [DatabaseModule],
  controllers: [PlatformSettingsController],
  providers: [PlatformSettingsService],
})
export class PlatformSettingsModule {}

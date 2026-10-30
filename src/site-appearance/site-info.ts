import { BadRequestException, Body, Controller, Get, Injectable, Put, Req, UseGuards } from '@nestjs/common';
import { IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';
import { DatabaseService } from '../database/database.services';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, SUPER_ADMIN } from '../auth/roles.decorator';
import { Public } from '../auth/public.decorator';

/**
 * Informations du site (B5, 30/10/2026, migration 026) : réglées par le super admin (admin → Paramètres),
 * lues par le site (pied de page, menu mobile, page Contact). Remplace les pages de paramètres du modèle d'origine,
 * qui écrivaient dans une ligne que le site ne lisait pas.
 * Réseau social vide = icône masquée. Carte : seulement un lien d'intégration Google Maps (affiché dans une iframe).
 */
export const SOCIAL_HOSTS: Record<string, string[]> = {
  instagram: ['instagram.com'],
  facebook: ['facebook.com', 'fb.com'],
  tiktok: ['tiktok.com'],
  linkedin: ['linkedin.com'],
  x_url: ['x.com', 'twitter.com'],
  youtube: ['youtube.com', 'youtu.be'],
};
const SOCIAL_LABELS: Record<string, string> = {
  instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', linkedin: 'LinkedIn', x_url: 'X', youtube: 'YouTube',
};
export const SITE_INFO_DEFAULTS = {
  phone: '+229 01 67 69 81 91',
  email: 'contact@edotofamily.com',
  address: 'St Rita, Cotonou, Bénin',
  map_url: null as string | null,
  instagram: null as string | null,
  facebook: null as string | null,
  tiktok: null as string | null,
  linkedin: null as string | null,
  x_url: null as string | null,
  youtube: null as string | null,
};
type SiteInfo = typeof SITE_INFO_DEFAULTS;
const COLUMNS = Object.keys(SITE_INFO_DEFAULTS) as (keyof SiteInfo)[];

@StrictDto()
export class SiteInfoDto {
  @IsOptional() @IsScalar() phone?: string;
  @IsOptional() @IsScalar() email?: string;
  @IsOptional() @IsScalar() address?: string;
  @IsOptional() @IsScalar() map_url?: string;
  @IsOptional() @IsScalar() instagram?: string;
  @IsOptional() @IsScalar() facebook?: string;
  @IsOptional() @IsScalar() tiktok?: string;
  @IsOptional() @IsScalar() linkedin?: string;
  @IsOptional() @IsScalar() x_url?: string;
  @IsOptional() @IsScalar() youtube?: string;
}

const clean = (v: any) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

function httpsUrl(raw: string, hosts: string[], label: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BadRequestException(`${label} : lien invalide.`);
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  if (u.protocol !== 'https:' || !hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
    throw new BadRequestException(`${label} : le lien doit commencer par https:// et mener à ${hosts[0]}.`);
  }
  if (raw.length > 300) throw new BadRequestException(`${label} : lien trop long.`);
  return u.toString();
}

/** Valide tout le formulaire ; un champ vide efface la valeur (réseau masqué, carte par défaut) */
export function parseSiteInfo(body: any): SiteInfo {
  const phone = clean(body?.phone);
  if (!/^\+?[0-9 ]{6,30}$/.test(phone)) throw new BadRequestException('Téléphone invalide (chiffres, espaces et + seulement).');
  const email = clean(body?.email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email) || email.length > 190) throw new BadRequestException('Adresse e-mail invalide.');
  const address = clean(body?.address);
  if (!address || address.length > 190) throw new BadRequestException('Adresse obligatoire (190 caractères au plus).');
  const mapRaw = clean(body?.map_url);
  let map_url: string | null = null;
  if (mapRaw) {
    if (!/^https:\/\/www\.google\.com\/maps\/embed\?/.test(mapRaw) || mapRaw.length > 600) {
      throw new BadRequestException('Carte : collez le lien « Intégrer une carte » de Google Maps (https://www.google.com/maps/embed?…).');
    }
    map_url = mapRaw;
  }
  const out: any = { phone, email, address, map_url };
  for (const key of Object.keys(SOCIAL_HOSTS)) {
    const raw = clean(body?.[key]);
    out[key] = raw ? httpsUrl(raw, SOCIAL_HOSTS[key], SOCIAL_LABELS[key]) : null;
  }
  return out;
}

@Injectable()
export class SiteInfoService {
  constructor(private readonly db: DatabaseService) {}

  // Public. Table absente ou vide : valeurs de départ (celles que le site affichait)
  async get(): Promise<SiteInfo & { updated_at: string | null }> {
    try {
      const [rows]: any = await this.db.getPool().query(`SELECT ${COLUMNS.join(', ')}, updated_at FROM site_info WHERE id = 1 LIMIT 1`);
      const r = rows?.[0];
      if (!r) return { ...SITE_INFO_DEFAULTS, updated_at: null };
      const out: any = { updated_at: r.updated_at ?? null };
      for (const c of COLUMNS) out[c] = r[c] ?? (c === 'phone' || c === 'email' || c === 'address' ? SITE_INFO_DEFAULTS[c] : null);
      return out;
    } catch {
      return { ...SITE_INFO_DEFAULTS, updated_at: null };
    }
  }

  async update(body: any, adminId: number) {
    const v = parseSiteInfo(body);
    await this.db.getPool().query(
      `INSERT INTO site_info (id, ${COLUMNS.join(', ')}, updated_at, updated_by) VALUES (1, ${COLUMNS.map(() => '?').join(', ')}, NOW(), ?)
       ON DUPLICATE KEY UPDATE ${COLUMNS.map((c) => `${c} = VALUES(${c})`).join(', ')}, updated_at = NOW(), updated_by = VALUES(updated_by)`,
      [...COLUMNS.map((c) => v[c]), adminId || null],
    );
    return { success: true, message: 'Informations du site enregistrées.', ...(await this.get()) };
  }
}

@Controller()
export class SiteInfoController {
  constructor(private readonly service: SiteInfoService) {}

  @Public()
  @Get('site-info')
  get() {
    return this.service.get();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(SUPER_ADMIN)
  @Put('admin/site-info')
  update(@Body() body: SiteInfoDto, @Req() req: any) {
    return this.service.update(body, Number(req.user?.id));
  }
}

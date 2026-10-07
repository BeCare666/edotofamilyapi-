import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.services';

// Polices proposées au super admin (07/10/2026, liste validée par l'utilisateur).
// Les mêmes clés existent côté site (edoto/lib/siteFont.js) et admin (admin/src/utils/site-font.ts).
export const SITE_FONT_KEYS = [
  'poppins', 'inter', 'plus-jakarta-sans', 'dm-sans', 'manrope', 'outfit',
  'figtree', 'nunito-sans', 'montserrat', 'lato', 'work-sans', 'cormorant-garamond',
] as const;
export const DEFAULT_SITE_FONT = 'poppins';

@Injectable()
export class SiteAppearanceService {
  constructor(private readonly db: DatabaseService) {}

  // Public : le site et l'admin lisent la police à appliquer. Table absente ou vide : Poppins.
  async get() {
    try {
      const [rows]: any = await this.db.getPool().query(`SELECT font_key, updated_at FROM site_appearance WHERE id = 1 LIMIT 1`);
      const key = rows[0]?.font_key;
      return { font: SITE_FONT_KEYS.includes(key) ? key : DEFAULT_SITE_FONT, updated_at: rows[0]?.updated_at ?? null };
    } catch {
      return { font: DEFAULT_SITE_FONT, updated_at: null };
    }
  }

  // Super admin : uniquement une police de la liste
  async setFont(font: unknown, adminId: number) {
    if (typeof font !== 'string' || !(SITE_FONT_KEYS as readonly string[]).includes(font)) {
      throw new BadRequestException('Police inconnue.');
    }
    await this.db.getPool().query(
      `INSERT INTO site_appearance (id, font_key, updated_at, updated_by) VALUES (1, ?, NOW(), ?)
       ON DUPLICATE KEY UPDATE font_key = VALUES(font_key), updated_at = NOW(), updated_by = VALUES(updated_by)`,
      [font, adminId],
    );
    return this.get();
  }
}

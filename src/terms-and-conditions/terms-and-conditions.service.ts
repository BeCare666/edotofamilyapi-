import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.services';
import { CreateTermsAndConditionsDto } from './dto/create-terms-and-conditions.dto';
import { UpdateTermsAndConditionsDto } from './dto/update-terms-and-conditions.dto';
import { GetTermsAndConditionsDto } from './dto/get-terms-and-conditions.dto';

@Injectable()
export class TermsAndConditionsService {
  constructor(private readonly DatabaseService: DatabaseService) { }

  async create(dto: CreateTermsAndConditionsDto) {
    const pool = this.DatabaseService.getPool();

    // Vérif slug existant
    const slug = dto.title.toLowerCase().replace(/\s+/g, '-');
    const [existing]: any = await pool.query(
      `SELECT id FROM terms_and_conditions WHERE slug = ? LIMIT 1`,
      [slug],
    );
    if (existing.length > 0) {
      throw new Error(`Slug already exists: ${slug}`);
    }

    const [result]: any = await pool.query(
      `INSERT INTO terms_and_conditions 
      (title, slug, description, type, issued_by, is_approved, language, translated_languages, shop_id) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        dto.title,
        slug,
        dto.description,
        dto.type || 'global',
        dto.issued_by || 'Super Admin',
        dto.is_approved ? 1 : 0,
        dto.language || 'en',
        JSON.stringify(dto.translated_languages || []),
        dto.shop_id || null,
      ],
    );

    return this.findOne(result.insertId, dto.language || 'en');
  }

  async findAllTermsAndConditions(query: GetTermsAndConditionsDto) {
    const pool = this.DatabaseService.getPool();
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const offset = (page - 1) * limit;

    const where: string[] = [];
    const params: any[] = [];

    if (query.search) {
      const searchParts = query.search.split(';');
      searchParts.forEach((part) => {
        const [key, value] = part.split(':');
        if (key && value) {
          if (key === 'title') {
            where.push(`tc.title LIKE ?`);
            params.push(`%${value}%`);
          }
          if (key === 'description') {
            where.push(`tc.description LIKE ?`);
            params.push(`%${value}%`);
          }
        }
      });
    }

    if (query.language) {
      where.push(`tc.language = ?`);
      params.push(query.language);
    }
    if (query.type) {
      where.push(`tc.type = ?`);
      params.push(query.type);
    }
    if (query.issued_by) {
      where.push(`tc.issued_by = ?`);
      params.push(query.issued_by);
    }
    if (query.is_approved !== undefined) {
      where.push(`tc.is_approved = ?`);
      params.push(query.is_approved ? 1 : 0);
    }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [countRows]: any = await pool.query(
      `SELECT COUNT(*) as total FROM terms_and_conditions tc ${whereSql}`,
      params,
    );
    const total = countRows[0]?.total ?? 0;

    const allowedOrderFields = ['created_at', 'title', 'updated_at'];
    const orderBySafe = allowedOrderFields.includes(
      query.orderBy?.toLowerCase(),
    )
      ? query.orderBy
      : 'created_at';
    const sortedBySafe =
      query.sortedBy?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const [rows]: any = await pool.query(
      `SELECT tc.*,
              s.id AS shop_id, s.name AS shop_name, s.slug AS shop_slug,
              m.id AS shop_logo_id, m.url AS shop_logo_url
       FROM terms_and_conditions tc
       LEFT JOIN shops s ON tc.shop_id = s.id
       LEFT JOIN media m ON s.logo_image_id = m.id
       ${whereSql}
       ORDER BY tc.${orderBySafe} ${sortedBySafe}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    const data = rows.map((row: any) => ({
      ...row,
      translated_languages: (() => {
        try {
          return JSON.parse(row.translated_languages || '[]');
        } catch {
          return [];
        }
      })(),
      is_approved: !!row.is_approved,
      shop: row.shop_id
        ? {
          id: row.shop_id,
          name: row.shop_name,
          slug: row.shop_slug,
          logo: row.shop_logo_url
            ? { id: row.shop_logo_id, url: row.shop_logo_url }
            : null,
        }
        : null,
    }));

    return {
      data,
      total,
      current_page: page,
      per_page: limit,
      last_page: Math.ceil(total / limit),
    };
  }

  async findOne(idOrSlug: number | string, language: string) {
    const pool = this.DatabaseService.getPool();
    const where = isNaN(Number(idOrSlug)) ? 't.slug = ?' : 't.id = ?';

    const [rows]: any = await pool.query(
      `SELECT t.*,
              s.id AS shop_id, s.name AS shop_name, s.slug AS shop_slug,
              m.id AS shop_logo_id, m.url AS shop_logo_url
       FROM terms_and_conditions t
       LEFT JOIN shops s ON t.shop_id = s.id
       LEFT JOIN media m ON s.logo_image_id = m.id
       WHERE ${where} AND t.language = ?
       LIMIT 1`,
      [idOrSlug, language],
    );

    if (!rows.length) return null;
    const row = rows[0];

    return {
      ...row,
      translated_languages: (() => {
        try {
          return JSON.parse(row.translated_languages || '[]');
        } catch {
          return [];
        }
      })(),
      is_approved: !!row.is_approved,
      shop: row.shop_id
        ? {
          id: row.shop_id,
          name: row.shop_name,
          slug: row.shop_slug,
          logo: row.shop_logo_url
            ? { id: row.shop_logo_id, url: row.shop_logo_url }
            : null,
        }
        : null,
    };
  }

  async update(id: number, dto: UpdateTermsAndConditionsDto) {
    const pool = this.DatabaseService.getPool();

    await pool.query(
      `UPDATE terms_and_conditions 
       SET title=?, description=?, type=?, issued_by=?, is_approved=?, language=?, translated_languages=?, shop_id=?
       WHERE id=?`,
      [
        dto.title,
        dto.description,
        dto.type,
        dto.issued_by,
        dto.is_approved ? 1 : 0,
        dto.language,
        JSON.stringify(dto.translated_languages || []),
        dto.shop_id || null,
        id,
      ],
    );

    return this.findOne(id, dto.language || 'en');
  }

  async remove(id: number) {
    const pool = this.DatabaseService.getPool();
    await pool.query(`DELETE FROM terms_and_conditions WHERE id = ?`, [id]);
    return { success: true, message: `Terms and conditions #${id} deleted` };
  }

  async approveTermsAndCondition(id: number) {
    const pool = this.DatabaseService.getPool();
    await pool.query(
      `UPDATE terms_and_conditions SET is_approved = 1 WHERE id = ?`,
      [id],
    );
    return this.findOne(id, 'en');
  }

  async disapproveTermsAndCondition(id: number) {
    const pool = this.DatabaseService.getPool();
    await pool.query(
      `UPDATE terms_and_conditions SET is_approved = 0 WHERE id = ?`,
      [id],
    );
    return this.findOne(id, 'en');
  }
}

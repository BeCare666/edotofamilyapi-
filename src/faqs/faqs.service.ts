import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.services';
import { GetFaqsDto } from './dto/get-faqs.dto';
import { CreateFaqDto } from './dto/create-faq.dto';
import { UpdateFaqDto } from './dto/update-faq.dto';
import Fuse from 'fuse.js';
import { paginate } from 'src/common/pagination/paginate';

@Injectable()
export class FaqsService {
  constructor(private readonly databaseService: DatabaseService) {}

  private getPool() {
    return this.databaseService.getPool();
  }

  async create(dto: CreateFaqDto) {
    const pool = this.getPool();

    // Générer un slug
    const slug = dto.faq_title.toLowerCase().replace(/\s+/g, '-');
    const [existing]: any = await pool.query(
      `SELECT id FROM faqs WHERE slug = ? LIMIT 1`,
      [slug],
    );
    if (existing.length > 0) {
      throw new Error(`Slug already exists: ${slug}`);
    }

    const [result]: any = await pool.query(
      `INSERT INTO faqs 
        (faq_title, slug, faq_description, faq_type, issued_by, language, translated_languages, shop_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        dto.faq_title,
        slug,
        dto.faq_description,
        dto.faq_type || 'shop',
        dto.issued_by || 'Admin',
        dto.language || 'en',
        JSON.stringify(dto.translated_languages || []),
        dto.shop_id || null,
      ],
    );

    return this.getFaq(result.insertId, dto.language || 'en');
  }

  async findAllFaqs(query: GetFaqsDto) {
    const pool = this.getPool();
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const offset = (page - 1) * limit;

    const where: string[] = [];
    const params: any[] = [];

    if (query.shop_id) {
      where.push('f.shop_id = ?');
      params.push(query.shop_id);
    }

    if (query.search) {
      const searchParts = query.search.split(';');
      searchParts.forEach((part) => {
        const [key, value] = part.split(':');
        if (key && value) {
          if (key === 'faq_title') {
            where.push('f.faq_title LIKE ?');
            params.push(`%${value}%`);
          }
          if (key === 'faq_description') {
            where.push('f.faq_description LIKE ?');
            params.push(`%${value}%`);
          }
        }
      });
    }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [countRows]: any = await pool.query(
      `SELECT COUNT(*) as total FROM faqs f ${whereSql}`,
      params,
    );
    const total = countRows[0]?.total || 0;

    const [rows]: any = await pool.query(
      `SELECT f.*,
              s.id AS shop_id, s.name AS shop_name, s.slug AS shop_slug,
              m.id AS shop_logo_id, m.url AS shop_logo_url
       FROM faqs f
       LEFT JOIN shops s ON f.shop_id = s.id
       LEFT JOIN media m ON s.logo_image_id = m.id
       ${whereSql}
       ORDER BY f.id DESC
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

  async getFaq(idOrSlug: number | string, language?: string) {
    const pool = this.getPool();
    const where = isNaN(Number(idOrSlug)) ? 'f.slug = ?' : 'f.id = ?';

    const [rows]: any = await pool.query(
      `SELECT f.*,
              s.id AS shop_id, s.name AS shop_name, s.slug AS shop_slug,
              m.id AS shop_logo_id, m.url AS shop_logo_url
       FROM faqs f
       LEFT JOIN shops s ON f.shop_id = s.id
       LEFT JOIN media m ON s.logo_image_id = m.id
       WHERE ${where} ${language ? 'AND f.language = ?' : ''}
       LIMIT 1`,
      language ? [idOrSlug, language] : [idOrSlug],
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

  async update(id: number, dto: UpdateFaqDto) {
    const pool = this.getPool();
    await pool.query(
      `UPDATE faqs 
       SET faq_title=?, faq_description=?, faq_type=?, issued_by=?, language=?, translated_languages=?, shop_id=?
       WHERE id=?`,
      [
        dto.faq_title,
        dto.faq_description,
        dto.faq_type,
        dto.issued_by,
        dto.language,
        JSON.stringify(dto.translated_languages || []),
        dto.shop_id || null,
        id,
      ],
    );

    return this.getFaq(id, dto.language || 'en');
  }

  async remove(id: number) {
    const pool = this.getPool();
    await pool.query(`DELETE FROM faqs WHERE id = ?`, [id]);
    return { success: true, message: `Faq #${id} deleted` };
  }
}

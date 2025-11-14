import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateTagDto } from './dto/create-tag.dto';
import { GetTagsDto } from './dto/get-tags.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { DatabaseService } from '../database/database.services';
import { paginate } from 'src/common/pagination/paginate';

@Injectable()
export class TagsService {
  constructor(private readonly DatabaseService: DatabaseService) { }

  async create(createTagDto: CreateTagDto) {
    const { name, slug, language, icon, details, type_id } = createTagDto;
    const pool = this.DatabaseService.getPool();

    const [result]: any = await pool.query(
      `INSERT INTO tags (name, slug, language, icon, details, type_id) VALUES (?, ?, ?, ?, ?, ?)`,
      [name, slug, language, icon, details, type_id || null]
    );

    const insertedId = result.insertId;

    const [rows]: any = await pool.query(`SELECT * FROM tags WHERE id = ?`, [insertedId]);

    return rows[0];
  }

  async findAll({ page = 1, limit = 10, search }: GetTagsDto) {
    const pool = this.DatabaseService.getPool();
    const offset = (page - 1) * limit;

    let query = `SELECT * FROM tags WHERE deleted_at IS NULL`;
    let countQuery = `SELECT COUNT(*) as total FROM tags WHERE deleted_at IS NULL`;
    const params = [];

    if (search) {
      query += ` AND name LIKE ?`;
      countQuery += ` AND name LIKE ?`;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(Number(limit), Number(offset));

    const [rows]: any = await pool.query(query, params);
    const [countRows]: any = await pool.query(countQuery, params.slice(0, -2));
    const total = countRows[0].total;

    const url = `/tags?limit=${limit}`;
    return {
      data: rows,
      ...paginate(total, page, limit, rows.length, url),
    };
  }

  async findOne(param: number | string, language?: string) {
    const pool = this.DatabaseService.getPool();
    const isId = !isNaN(Number(param));
    const query = isId
      ? `SELECT * FROM tags WHERE id = ?`
      : `SELECT * FROM tags WHERE slug = ? ${language ? 'AND language = ?' : ''}`;

    const [rows]: any = await pool.query(
      query,
      isId ? [param] : [param, ...(language ? [language] : [])]
    );

    const tag = rows[0];

    if (!tag) {
      throw new NotFoundException(`Tag not found`);
    }

    return tag;
  }

  async update(id: number, updateTagDto: UpdateTagDto) {
    const pool = this.DatabaseService.getPool();
    const fields = Object.entries(updateTagDto).filter(([_, v]) => v !== undefined);

    if (fields.length === 0) {
      throw new Error('No fields to update');
    }

    const setClause = fields.map(([key]) => `${key} = ?`).join(', ');
    const values = fields.map(([_, value]) => value);

    await pool.query(
      `UPDATE tags SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [...values, id]
    );

    const [rows]: any = await pool.query(`SELECT * FROM tags WHERE id = ?`, [id]);

    return rows[0];
  }

  async remove(id: number) {
    const pool = this.DatabaseService.getPool();
    await pool.query(`UPDATE tags SET deleted_at = NOW() WHERE id = ?`, [id]);
    return { message: `Tag #${id} soft deleted` };
  }
}

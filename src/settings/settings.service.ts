import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.services';
import { CreateSettingDto } from './dto/create-setting.dto';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { Setting } from './entities/setting.entity';

@Injectable()
export class SettingsService {
  constructor(private readonly db: DatabaseService) { }

  async create(createSettingDto: CreateSettingDto): Promise<Setting> {
    const now = new Date();

    const [result]: any = await this.db.getPool().query(
      `INSERT INTO settings (options, language, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
      [
        JSON.stringify(createSettingDto.options || {}),
        createSettingDto.language || 'en',
        now,
        now,
      ],
    );

    return this.findOne(result.insertId);
  }

  async findAll(): Promise<Setting> {
    const [rows]: any = await this.db.getPool().query(
      'SELECT * FROM settings ORDER BY id DESC LIMIT 1',
    );

    if (!rows || rows.length === 0) {
      throw new NotFoundException('Aucun paramètre trouvé.');
    }

    const row = rows[0];
    return {
      id: row.id,
      options: this.safeParse(row.options, {}),
      language: row.language,
      translated_languages: [], // ✅ ajouté ici
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  async findOne(id: number): Promise<Setting> {
    const [rows]: any = await this.db.getPool().query(
      'SELECT * FROM settings WHERE id = ? LIMIT 1',
      [id],
    );

    if (!rows || rows.length === 0) {
      throw new NotFoundException(`Setting #${id} introuvable`);
    }

    const row = rows[0];
    return {
      id: row.id,
      options: this.safeParse(row.options, {}),
      language: row.language,
      translated_languages: [], // ✅ ajouté ici aussi
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

async update(id: number, updateSettingDto: UpdateSettingDto): Promise<Setting> {
  const now = new Date();

  const existing = await this.findOne(id);

  const fields: string[] = [];
  const values: any[] = [];

  for (const [key, value] of Object.entries(updateSettingDto)) {
    if (value !== undefined) {
      if (key === 'options') {
        const jsonString = typeof value === 'string' ? value : JSON.stringify(value);
        fields.push('options = ?');
        values.push(jsonString);
      } else {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
  }

  if (fields.length === 0) {
    return existing;
  }

  fields.push('updated_at = ?');
  values.push(now); // juste now ici
  const sql = `UPDATE settings SET ${fields.join(', ')} WHERE id = ?`;
  values.push(id); // id pour WHERE

  const [result]: any = await this.db.getPool().query(sql, values);
  if (result.affectedRows === 0) {
    throw new NotFoundException(`Setting #${id} non trouvé`);
  }

  return this.findOne(id);
}


  async remove(id: number): Promise<{ message: string }> {
    const [result]: any = await this.db.getPool().query(
      'DELETE FROM settings WHERE id = ?',
      [id],
    );

    if (result.affectedRows === 0) {
      throw new NotFoundException(`Setting #${id} non trouvé`);
    }

    return { message: `Setting #${id} supprimé avec succès` };
  }

  private safeParse(value: any, fallback: any) {
    try {
      return typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
      return fallback;
    }
  }
}

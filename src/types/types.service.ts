import { Injectable } from '@nestjs/common';
import { CreateTypeDto } from './dto/create-type.dto';
import { UpdateTypeDto } from './dto/update-type.dto';
import { GetTypesDto } from './dto/get-types.dto';
import { DatabaseService } from '../database/database.services';
import { toSlug } from 'src/utils/slug';

@Injectable()
export class TypesService {
  constructor(private readonly db: DatabaseService) { }

  async create(dto: CreateTypeDto) {
    const slug = dto.slug || toSlug(dto.name);

    const [result]: any = await this.db.getPool().query(
      'INSERT INTO types (name, slug, icon, language) VALUES (?, ?, ?, ?)',
      [dto.name, slug, dto.icon, dto.language],
    );

    return { id: result.insertId, ...dto, slug };
  }

  async getTypes(query: GetTypesDto) {
    const conditions: string[] = [];
    const values: any[] = [];

    // 🔍 Filtre par recherche
    if (query.search) {
      conditions.push('(name LIKE ? OR slug LIKE ?)');
      values.push(`%${query.search}%`, `%${query.search}%`);
    }

    // 🔍 Filtre par langue
    if (query.language) {
      conditions.push('language = ?');
      values.push(query.language);
    }

    let sql = 'SELECT * FROM types';

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    // 🔽 Gestion du ORDER BY
    let orderArray: any[] = [];

    if (query.orderBy) {
      try {
        if (Array.isArray(query.orderBy)) {
          orderArray = query.orderBy;
        } else if (typeof query.orderBy === 'string') {
          // Exemple: '[{"column":"NAME","order":"ASC"}]'
          orderArray = JSON.parse(query.orderBy);
        } else {
          // Cas objet unique
          orderArray = [query.orderBy];
        }
      } catch (e) {
        orderArray = [];
      }
    }

    if (orderArray.length > 0) {
      const colMap: Record<string, string> = {
        NAME: 'name',
        CREATED_AT: 'created_at',
        UPDATED_AT: 'updated_at',
      };

      const orders = orderArray
        .map((clause) => {
          const column = colMap[clause.column];
          const direction =
            clause.order?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
          return column ? `${column} ${direction}` : null;
        })
        .filter(Boolean);

      if (orders.length > 0) {
        sql += ' ORDER BY ' + orders.join(', ');
      } else {
        sql += ' ORDER BY created_at DESC';
      }
    } else {
      sql += ' ORDER BY created_at DESC';
    }

    // 📌 Exécution
    const [rows] = await this.db.getPool().query(sql, values);
    return rows;
  }


  async getTypeBySlug(slug: string) {
    const [rows]: any = await this.db.getPool().query(
      'SELECT * FROM types WHERE slug = ?',
      [slug],
    );
    return rows[0];
  }

  async update(id: number, dto: UpdateTypeDto) {
    const slug = dto.slug || toSlug(dto.name);

    await this.db.getPool().query(
      'UPDATE types SET name = ?, slug = ?, icon = ?, language = ? WHERE id = ?',
      [dto.name, slug, dto.icon, dto.language, id],
    );

    return { id, ...dto, slug };
  }

  async remove(id: number) {
    await this.db.getPool().query('DELETE FROM types WHERE id = ?', [id]);
    return { message: 'Type supprimé avec succès' };
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.services';
import { CreateCorridorDto } from './dtos/create-corridor.dto';
import { UpdateCorridorDto } from './dtos/update-corridor.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CorridorsService {
  constructor(private readonly db: DatabaseService) { }

  async create(createDto: CreateCorridorDto) {
    const {
      from_countries_id,
      to_countries_id,
      from_countries_code,
      to_countries_code,
      douanes,
      taxes,
      logistique,
      from_latitude,
      from_longitude,
      to_latitude,
      to_longitude,

    } = createDto;

    const id = uuidv4(); // Génère un ID unique si ta colonne id est VARCHAR
    console.log('Type de createDto:', typeof createDto);
    await this.db.query(
      `INSERT INTO corridors (id, from_countries_id,  to_countries_id, from_countries_code, to_countries_code, douanes, taxes, logistique, from_latitude, from_longitude, to_latitude, to_longitude)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, from_countries_id, to_countries_id, from_countries_code, to_countries_code, douanes, taxes, logistique, from_latitude, from_longitude, to_latitude, to_longitude],
    );

    return this.findOne(id);
  }

  async findAll() {
    return this.db.query(`SELECT * FROM corridors`);
  }

  async findOne(id: string) {
    const [rows] = await this.db.query(
      `SELECT * FROM corridors WHERE id = ?`,
      [id],
    );
    if (!rows.length) throw new NotFoundException('Corridor not found');
    return rows[0];
  }

  async update(id: string, updateDto: UpdateCorridorDto) {
    const fields = [];
    const params = [];

    for (const [key, value] of Object.entries(updateDto)) {
      fields.push(`${key} = ?`);
      params.push(value);
    }

    if (fields.length) {
      params.push(id);
      await this.db.query(
        `UPDATE corridors SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`,
        params,
      );
    }

    return this.findOne(id);
  }

  async remove(id: string) {
    await this.db.query(`DELETE FROM corridors WHERE id = ?`, [id]);
    return { message: `Corridor ${id} removed.` };
  }
}

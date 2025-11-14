import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.services';
import { CreateTaxDto } from './dto/create-tax.dto';
import { UpdateTaxDto } from './dto/update-tax.dto';
import { Tax } from './entities/tax.entity';

@Injectable()
export class TaxesService {
  constructor(private readonly db: DatabaseService) { }

  async create(createTaxDto: CreateTaxDto): Promise<Tax> {
    const now = new Date();

    const [result]: any = await this.db.getPool().query(
      `INSERT INTO taxes 
        (country, state, zip, city, rate, name, is_global, priority, on_shipping, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        createTaxDto.country,
        createTaxDto.state ?? null,
        createTaxDto.zip ?? null,
        createTaxDto.city ?? null,
        createTaxDto.rate,
        createTaxDto.name,
        createTaxDto.is_global ?? null,
        createTaxDto.priority ?? null,
        createTaxDto.on_shipping ?? false,
        now,
        now,
      ],
    );

    return this.findOne(result.insertId);
  }

  async findAll(): Promise<Tax[]> {
    const [rows]: any = await this.db.getPool().query(
      'SELECT * FROM taxes ORDER BY created_at DESC',
    );
    return rows;
  }

  async findOne(id: number): Promise<Tax> {
    const [rows]: any = await this.db.getPool().query(
      'SELECT * FROM taxes WHERE id = ? LIMIT 1',
      [id],
    );

    if (!rows || rows.length === 0) {
      throw new NotFoundException(`Tax #${id} not found`);
    }

    return rows[0];
  }

  async update(id: number, updateTaxDto: UpdateTaxDto): Promise<Tax> {
    const now = new Date();

    // Construire la requête dynamiquement pour ne mettre à jour que les champs fournis
    const fields: string[] = [];
    const values: any[] = [];

    Object.entries(updateTaxDto).forEach(([key, value]) => {
      if (value !== undefined) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    });

    fields.push('updated_at = ?');
    values.push(now);
    values.push(id);

    const sql = `UPDATE taxes SET ${fields.join(', ')} WHERE id = ?`;

    const [result]: any = await this.db.getPool().query(sql, values);

    if (result.affectedRows === 0) {
      throw new NotFoundException(`Tax #${id} not found`);
    }

    return this.findOne(id);
  }

  async remove(id: number): Promise<{ message: string }> {
    const [result]: any = await this.db.getPool().query(
      'DELETE FROM taxes WHERE id = ?',
      [id],
    );

    if (result.affectedRows === 0) {
      throw new NotFoundException(`Tax #${id} not found`);
    }

    return { message: `Tax #${id} deleted successfully` };
  }
}

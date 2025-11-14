import { Injectable } from '@nestjs/common';
import { CreateWithdrawDto } from './dto/create-withdraw.dto';
import { ApproveWithdrawDto } from './dto/approve-withdraw.dto';
import { Withdraw } from './entities/withdraw.entity';
import { GetWithdrawsDto, WithdrawPaginator } from './dto/get-withdraw.dto';
import { paginate } from 'src/common/pagination/paginate';
import { DatabaseService } from 'src/database/database.services';
import { RowDataPacket } from 'mysql2';

@Injectable()
export class WithdrawsService {
  constructor(private readonly db: DatabaseService) { }

  // Création d'un retrait
  async create(createWithdrawDto: CreateWithdrawDto) {
    const pool = this.db.getPool();
    const sql = `
      INSERT INTO withdraws (shop_id, amount, payment_method, note, details, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;
    const values = [
      createWithdrawDto.shop_id,
      createWithdrawDto.amount,
      createWithdrawDto.payment_method,
      createWithdrawDto.note ?? null,
      createWithdrawDto.details ?? null,
      'pending', // status par défaut
    ];

    const [result] = await pool.query(sql, values);
    const insertId = (result as any).insertId;

    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM withdraws WHERE id = ?',
      [insertId],
    );
    return rows[0];
  }

  // Récupération paginée des retraits
  async getWithdraws(query: GetWithdrawsDto): Promise<WithdrawPaginator> {
    const pool = this.db.getPool();
    const page = Number(query.page ?? 1);
    const limit = Number(query.limit ?? 10);
    const offset = (page - 1) * limit;

    let conditions: string[] = [];
    let values: any[] = [];

    if (query.shop_id) {
      conditions.push('shop_id = ?');
      values.push(query.shop_id);
    }
    if (query.status) {
      conditions.push('status = ?');
      values.push(query.status);
    }

    const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    // Récupération des données
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM withdraws ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...values, limit, offset],
    );

    // Récupération du total pour la pagination
    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM withdraws ${whereClause}`,
      values,
    );

    const total = countRows[0].total;

    return {
      data: rows as Withdraw[],
      ...paginate(total, page, limit, rows.length, `/withdraws?limit=${limit}`),
    };
  }

  // Récupération d'un retrait par ID
  async findOne(id: number) {
    const pool = this.db.getPool();
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM withdraws WHERE id = ?', [id]);
    return rows[0] ?? null;
  }

  // Mise à jour d'un retrait (approbation, note, details)
  async update(id: number, approveWithdrawDto: ApproveWithdrawDto) {
    const pool = this.db.getPool();

    const fields: string[] = [];
    const values: any[] = [];

    if (approveWithdrawDto.status !== undefined) {
      fields.push('status = ?');
      values.push(approveWithdrawDto.status);
    }
    if (approveWithdrawDto.note !== undefined) {
      fields.push('note = ?');
      values.push(approveWithdrawDto.note);
    }
    if (approveWithdrawDto.details !== undefined) {
      fields.push('details = ?');
      values.push(approveWithdrawDto.details);
    }

    if (fields.length === 0) return null; // rien à mettre à jour

    values.push(id);

    const sql = `UPDATE withdraws SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`;
    await pool.query(sql, values);

    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM withdraws WHERE id = ?', [id]);
    return rows[0];
  }

  // Suppression d'un retrait
  async remove(id: number) {
    const pool = this.db.getPool();
    await pool.query('DELETE FROM withdraws WHERE id = ?', [id]);
    return { message: `Withdraw #${id} removed successfully` };
  }
}

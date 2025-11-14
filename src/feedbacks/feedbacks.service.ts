import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.services';
import { CreateFeedBackDto } from './dto/create-feedback.dto';
import { UpdateFeedBackDto } from './dto/update-feedback.dto';

@Injectable()
export class FeedbackService {
  constructor(private readonly db: DatabaseService) { }

  // Récupérer tous les feedbacks (optionnel : filtrage, pagination)
  async findAllFeedBacks(product_id?: number) {
    let sql = 'SELECT * FROM feedbacks';
    const values: any[] = [];
    if (product_id) {
      sql += ' WHERE product_id = ?';
      values.push(product_id);
    }
    const [rows] = await this.db.getPool().query(sql, values);
    return rows;
  }

  // Récupérer un feedback spécifique
  async findFeedBack(id: number) {
    const [rows]: any = await this.db.getPool().query(
      'SELECT * FROM feedbacks WHERE id = ?',
      [id],
    );
    return rows[0];
  }

  // Créer un feedback
  async create(dto: CreateFeedBackDto) {
    const [result]: any = await this.db.getPool().query(
      `INSERT INTO feedbacks 
       (user_id, product_id, model_type, model_id, positive, negative, comment) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        dto.user_id,
        dto.product_id,
        dto.model_type,
        dto.model_id,
        dto.positive,
        dto.negative,
        dto.comment,
      ],
    );
    return { id: result.insertId, ...dto };
  }

  // Mettre à jour un feedback
  async update(id: number, dto: UpdateFeedBackDto) {
    await this.db.getPool().query(
      `UPDATE feedbacks 
       SET positive = ?, negative = ?, comment = ? 
       WHERE id = ?`,
      [dto.positive, dto.negative, dto.comment, id],
    );
    return { id, ...dto };
  }

  // Supprimer un feedback
  async delete(id: number) {
    await this.db.getPool().query('DELETE FROM feedbacks WHERE id = ?', [id]);
    return { message: `Feedback #${id} supprimé avec succès` };
  }
}

import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.services';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { GetReviewsDto } from './dto/get-reviews.dto';
import { paginate } from 'src/common/pagination/paginate';

@Injectable()
export class ReviewService {
  constructor(private readonly databaseService: DatabaseService) { }

  async create(dto: CreateReviewDto) {
    const pool = this.databaseService.getPool();

    const [result]: any = await pool.query(
      `INSERT INTO reviews 
        (order_id, user_id, shop_id, product_id, variation_option_id, comment, rating, photos, positive_feedbacks_count, negative_feedbacks_count, abusive_reports_count, my_feedback, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        Number(dto.order_id),
        0, // Remplacer par user_id réel si disponible
        Number(dto.shop_id) || null,
        Number(dto.product_id),
        dto.variation_option_id || null,
        dto.comment,
        dto.rating || 0,
        JSON.stringify(dto.photos || []),
        0, // positive_feedbacks_count
        0, // negative_feedbacks_count
        0, // abusive_reports_count
        null, // my_feedback
      ]
    );

    return this.findReview(result.insertId);
  }

  async findAllReviews(query: GetReviewsDto) {
    const pool = this.databaseService.getPool();
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 30;
    const offset = (page - 1) * limit;

    const where: string[] = [];
    const params: any[] = [];

    if (query.product_id) {
      where.push('r.product_id = ?');
      params.push(Number(query.product_id));
    }
    if (query.user_id) {
      where.push('r.user_id = ?');
      params.push(Number(query.user_id));
    }
    if (query.shop_id) {
      where.push('r.shop_id = ?');
      params.push(Number(query.shop_id));
    }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [countRows]: any = await pool.query(
      `SELECT COUNT(*) as total FROM reviews r ${whereSql}`,
      params
    );
    const total = countRows[0]?.total || 0;

    const [rows]: any = await pool.query(
      `SELECT r.*,
              u.id AS user_id, u.name AS user_name, u.email AS user_email,
              p.id AS product_id, p.name AS product_name, p.slug AS product_slug
       FROM reviews r
       LEFT JOIN users u ON r.user_id = u.id
       LEFT JOIN products p ON r.product_id = p.id
       ${whereSql}
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const data = rows.map((row: any) => ({
      ...row,
      photos: JSON.parse(row.photos || '[]'),
      my_feedback: row.my_feedback ? JSON.parse(row.my_feedback) : null,
      user: {
        id: row.user_id,
        name: row.user_name,
        email: row.user_email,
      },
      product: {
        id: row.product_id,
        name: row.product_name,
        slug: row.product_slug,
      },
    }));

    const url = `/reviews?limit=${limit}`;
    return {
      data,
      ...paginate(total, page, limit, data.length, url),
    };
  }

  async findReview(id: number) {
    const pool = this.databaseService.getPool();
    const [rows]: any = await pool.query(
      `SELECT * FROM reviews WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!rows.length) return null;
    const row = rows[0];
    return {
      ...row,
      photos: JSON.parse(row.photos || '[]'),
      my_feedback: row.my_feedback ? JSON.parse(row.my_feedback) : null,
    };
  }

  async update(id: number, dto: UpdateReviewDto) {
    const pool = this.databaseService.getPool();
    await pool.query(
      `UPDATE reviews SET
         order_id = ?,
         user_id = ?,
         shop_id = ?,
         product_id = ?,
         variation_option_id = ?,
         comment = ?,
         rating = ?,
         photos = ?,
         positive_feedbacks_count = ?,
         negative_feedbacks_count = ?,
         abusive_reports_count = ?,
         my_feedback = ?,
         updated_at = NOW()
       WHERE id = ?`,
      [
        Number(dto.order_id),
        0, // Remplacer par user_id réel si nécessaire
        Number(dto.shop_id) || null,
        Number(dto.product_id),
        dto.variation_option_id || null,
        dto.comment,
        dto.rating || 0,
        JSON.stringify(dto.photos || []),
        dto.positive_feedbacks_count || 0,
        dto.negative_feedbacks_count || 0,
        dto.abusive_reports_count || 0,
        JSON.stringify(dto.my_feedback || null),
        id,
      ]
    );
    return this.findReview(id);
  }

  async delete(id: number) {
    const pool = this.databaseService.getPool();
    await pool.query(`DELETE FROM reviews WHERE id = ?`, [id]);
    return { success: true, message: `Review #${id} deleted` };
  }
}

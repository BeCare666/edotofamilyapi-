import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.services';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { GetQuestionDto } from './dto/get-questions.dto';
import Fuse from 'fuse.js';
import { paginate } from 'src/common/pagination/paginate';
import { Question } from './entities/question.entity';

@Injectable()
export class QuestionService {
  private fuse: Fuse<Question>;

  constructor(private readonly db: DatabaseService) {
    this.fuse = new Fuse([], { keys: [], threshold: 0.3 });
  }

  async findAllQuestions(query: GetQuestionDto) {
    const limit = query.limit || 10;
    const page = query.page || 1;
    const startIndex = (page - 1) * limit;

    // Récupère toutes les questions depuis la base
    let sql = 'SELECT * FROM questions';
    const conditions: string[] = [];
    const values: any[] = [];

    if (query.product_id) {
      conditions.push('product_id = ?');
      values.push(query.product_id);
    }

    if (conditions.length) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    const [rows] = await this.db.getPool().query(sql, values);
    let questions: Question[] = rows as Question[];

    // Recherche Fuse
    if (query.search) {
      const parseSearchParams = query.search.split(';');
      this.fuse = new Fuse(questions, { keys: [], threshold: 0.3 });

      for (const searchParam of parseSearchParams) {
        const [key, value] = searchParam.split(':');
        questions = this.fuse.search(value)?.map(({ item }) => item);
      }
    }

    const results = questions.slice(startIndex, startIndex + limit);
    const url = `/questions?search=${query.search}&limit=${limit}`;
    return {
      data: results,
      ...paginate(questions.length, page, limit, results.length, url),
    };
  }

  async findQuestion(id: number) {
    const [rows] = await this.db.getPool().query(
      'SELECT * FROM questions WHERE id = ?',
      [id],
    );
    return (rows as Question[])[0];
  }

  async create(dto: CreateQuestionDto) {
    const { user_id, shop_id, product_id, question, answer } = dto;
    const [result]: any = await this.db.getPool().query(
      `INSERT INTO questions 
       (user_id, shop_id, product_id, question, answer, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
      [user_id, shop_id, product_id, question, answer],
    );
    return this.findQuestion(result.insertId);
  }

  async update(id: number, dto: UpdateQuestionDto) {
    const fields = Object.keys(dto)
      .map((key) => `${key} = ?`)
      .join(', ');
    const values = Object.values(dto);

    await this.db.getPool().query(
      `UPDATE questions SET ${fields}, updated_at = NOW() WHERE id = ?`,
      [...values, id],
    );
    return this.findQuestion(id);
  }

  async remove(id: number) {
    await this.db.getPool().query('DELETE FROM questions WHERE id = ?', [id]);
    return { message: 'Question supprimée avec succès' };
  }
}

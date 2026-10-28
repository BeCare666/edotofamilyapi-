import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.services';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { GetQuestionDto } from './dto/get-questions.dto';
import Fuse from 'fuse.js';
import { paginate } from 'src/common/pagination/paginate';
import { Question } from './entities/question.entity';
import { parseLegacySearch } from '../common/legacy-search';

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

    // Recherche (19/10/2026) : la recherche Fuse sans clé ne trouvait jamais rien ;
    // texte simple ou « question:… » / « name:… », sur la question et la réponse
    const qx: any = query;
    const text = (typeof qx.text === 'string' && qx.text.trim()) || parseLegacySearch(query.search, ['question', 'name', 'text', 'q']).text;
    if (text) {
      const t = text.toLocaleLowerCase('fr');
      questions = questions.filter((qq: any) =>
        String(qq.question ?? '').toLocaleLowerCase('fr').includes(t) || String(qq.answer ?? '').toLocaleLowerCase('fr').includes(t),
      );
    }
    // Plus récentes d'abord
    questions = [...questions].sort((a: any, b: any) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());

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

  async create(dto: CreateQuestionDto & { user_id: number }) {
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
    // Uniquement les colonnes réelles : un nom de champ n'entre jamais tel quel dans le SQL
    const allowedFields = ['question', 'answer'];
    const entries = Object.entries(dto).filter(([key]) => allowedFields.includes(key));
    if (!entries.length) return this.findQuestion(id);
    const fields = entries.map(([key]) => `${key} = ?`).join(', ');
    const values = entries.map(([, value]) => value);

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

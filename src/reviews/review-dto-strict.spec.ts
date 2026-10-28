import 'reflect-metadata';
import { BadRequestException, Logger } from '@nestjs/common';
import { StrictBodyPipe } from 'src/common/strict-body';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { CreateReportDto } from './dto/create-report.dto';
import { CreateQuestionDto } from 'src/questions/dto/create-question.dto';
import { UpdateQuestionDto } from 'src/questions/dto/update-question.dto';

// Audit sécurité 2.3 (28/10/2026) : questions, avis, signalements (lot 5)
const body = (metatype: any) => ({ type: 'body' as const, metatype, data: '' });

describe('DTO questions, avis, signalements (lot 5)', () => {
  const pipe = new StrictBodyPipe();
  let warn: jest.SpyInstance;
  beforeEach(() => (warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)));
  afterEach(() => warn.mockRestore());

  it('champs lus par les services gardés, sans journal', async () => {
    const cases: [any, any][] = [
      [CreateQuestionDto, { shop_id: 1, product_id: 2, question: 'Q ?', answer: null }],
      [UpdateQuestionDto, { answer: 'R' }],
      [CreateReviewDto, { rating: 5, comment: 'c', photos: [{ original: 'u' }], product_id: 2, shop_id: 1, order_id: 3, variation_option_id: null }],
      [UpdateReviewDto, { comment: 'c', positive_feedbacks_count: 1, my_feedback: { positive: true } }],
      [CreateReportDto, { model_id: 1, model_type: 'Review', message: 'm' }],
    ];
    for (const [dto, v] of cases) {
      await expect(pipe.transform(JSON.parse(JSON.stringify(v)), body(dto))).resolves.toEqual(v);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('question : user_id du corps retiré (fixé par le contrôleur)', async () => {
    await expect(pipe.transform({ question: 'Q', user_id: 1 }, body(CreateQuestionDto))).resolves.toEqual({ question: 'Q' });
    await expect(pipe.transform({ answer: 'R', user_id: 1, product_id: 2 }, body(UpdateQuestionDto))).resolves.toEqual({ answer: 'R' });
  });

  it('objet dans un champ simple ou photos non tableau → 400', async () => {
    await expect(pipe.transform({ comment: { a: 1 } }, body(CreateReviewDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ photos: 'x' }, body(CreateReviewDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ question: ['Q'] }, body(CreateQuestionDto))).rejects.toBeInstanceOf(BadRequestException);
  });
});

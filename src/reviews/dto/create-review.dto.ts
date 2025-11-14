import { Attachment } from '../../common/entities/attachment.entity';

export class CreateReviewDto {
  rating: number;
  comment: string;
  photos?: Attachment[];   // 👈 ajouté
  product_id: number;
  shop_id: number;
  order_id: number;
  variation_option_id?: number;
}


export class UpdateReviewDto {
  rating?: number;
  comment?: string;
  photos?: Attachment[];
  product_id?: number;
  shop_id?: number;
  order_id?: number;
  variation_option_id?: number;
  positive_feedbacks_count?: number;
  negative_feedbacks_count?: number;
  abusive_reports_count?: number;
  my_feedback?: any;
}



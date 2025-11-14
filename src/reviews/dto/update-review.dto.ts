import { PartialType } from '@nestjs/swagger';
import { CreateReviewDto } from './create-review.dto';

export class UpdateReviewDto extends PartialType(CreateReviewDto) {
    positive_feedbacks_count?: number;
    negative_feedbacks_count?: number;
    abusive_reports_count?: number;
    my_feedback?: any;
}

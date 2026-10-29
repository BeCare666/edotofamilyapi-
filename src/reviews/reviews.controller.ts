import {
  Controller,
  Get,
  Param,
  Query,
  Put,
  Post,
  Body,
  Delete,
} from '@nestjs/common';
import { CreateReviewDto } from './dto/create-review.dto';
import { GetReviewsDto, ReviewPaginator } from './dto/get-reviews.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { ReviewService } from './reviews.service';
import { SuperAdminOnly } from '../auth/super-admin-only.decorator';
import { Public } from '../auth/public.decorator';
import { SensitiveAction } from '../auth/step-up';

@Controller('reviews')
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  //   find all reviews
  // TODO: there is a bug in displaying all reviews
  // front-end a issue ase with pobon paul
  // In product single page front-end all the reviews apperaed. It should be based on product ID.
  @Public()
  @Get()
  async findAll(@Query() query: GetReviewsDto) {
    return this.reviewService.findAllReviews(query);
  }

  //   find one review by ID
  @Public()
  @Get(':id')
  find(@Param('id') id: string) {
    return this.reviewService.findReview(+id);
  }

  //  create a new review
  @SuperAdminOnly()
  @Post()
  create(@Body() createReviewDto: CreateReviewDto) {
    return this.reviewService.create(createReviewDto);
  }

  @SuperAdminOnly()
  @Put(':id')
  update(@Param('id') id: string, @Body() updateReviewDto: UpdateReviewDto) {
    return this.reviewService.update(+id, updateReviewDto);
  }

  // delete a review
  @SuperAdminOnly()
  @SensitiveAction() // audit 3.1 : code redemandé
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.reviewService.delete(+id);
  }
}

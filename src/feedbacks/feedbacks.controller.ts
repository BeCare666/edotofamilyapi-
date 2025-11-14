import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { CreateFeedBackDto } from './dto/create-feedback.dto';
import { UpdateFeedBackDto } from './dto/update-feedback.dto';
import { FeedbackService } from './feedbacks.service';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

@Controller('feedbacks')
export class FeedbackController {
  constructor(private feedbackService: FeedbackService) { }

  @Get()
  async findAll() {
    return this.feedbackService.findAllFeedBacks();
  }

  // get single feedback
  @Get(':id')
  find(@Param('id') id: number) {
    return this.feedbackService.findFeedBack(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() dto: CreateFeedBackDto, @Req() req: any) {
    // Récupérer l'ID de l'utilisateur depuis le JWT validé
    const userId = req.user.id;

    // On fusionne le DTO reçu avec user_id
    const feedbackDto = { ...dto, user_id: userId };

    // Appel du service pour créer le feedback
    return this.feedbackService.create(feedbackDto);
  }

  // update a feedback
  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() updateFeedBackDto: UpdateFeedBackDto,
  ) {
    return this.feedbackService.update(+id, updateFeedBackDto);
  }

  // delete a feedback
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.feedbackService.delete(+id);
  }
}

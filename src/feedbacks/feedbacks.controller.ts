import { Controller, Get, Param } from '@nestjs/common';
import { FeedbackService } from './feedbacks.service';
import { SuperAdminOnly } from '../auth/super-admin-only.decorator';

// Lecture seule, réservée au super admin (nettoyage N5, 27/10/2026) : aucun écran n'écrit d'avis.
@Controller('feedbacks')
export class FeedbackController {
  constructor(private feedbackService: FeedbackService) { }

  @SuperAdminOnly()
  @Get()
  async findAll() {
    return this.feedbackService.findAllFeedBacks();
  }

  // get single feedback
  @SuperAdminOnly()
  @Get(':id')
  find(@Param('id') id: number) {
    return this.feedbackService.findFeedBack(id);
  }
}

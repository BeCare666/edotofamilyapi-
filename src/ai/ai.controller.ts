import { Body, Controller, Post } from '@nestjs/common';
import { AiService } from './ai.service';
import { CreateAiDto } from './dto/create-ai.dto';
import { SuperAdminOnly } from '../auth/super-admin-only.decorator';

@Controller()
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @SuperAdminOnly()
  @Post('generate-descriptions')
  create(@Body() createAiDto: CreateAiDto) {
    return this.aiService.create(createAiDto);
  }
}

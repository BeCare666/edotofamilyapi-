import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { FaqsService } from './faqs.service';
import { GetFaqsDto } from './dto/get-faqs.dto';
import { CreateFaqDto } from './dto/create-faq.dto';
import { UpdateFaqDto } from './dto/update-faq.dto';
import { SuperAdminOnly } from '../auth/super-admin-only.decorator';
import { Public } from '../auth/public.decorator';

@Controller('faqs')
export class FaqsController {
  constructor(private faqService: FaqsService) {}

  @SuperAdminOnly()
  @Post()
  createFaq(@Body() createFaqDto: CreateFaqDto) {
    return this.faqService.create(createFaqDto);
  }

  @Public()
  @Get()
  findAll(@Query() query: GetFaqsDto) {
    return this.faqService.findAllFaqs(query);
  }

  @Public()
  @Get(':param')
  getFaq(@Param('param') param: string, @Query('language') language: string) {
    return this.faqService.getFaq(param, language);
  }

  @SuperAdminOnly()
  @Put(':id')
  update(
    @Param('id') id: string,
    @Param('language') language: string,
    @Body() updateFaqDto: UpdateFaqDto,
  ) {
    return this.faqService.update(+id, updateFaqDto);
  }

  @SuperAdminOnly()
  @Delete(':id')
  deleteFaq(@Param('id') id: string) {
    return this.faqService.remove(+id);
  }
}

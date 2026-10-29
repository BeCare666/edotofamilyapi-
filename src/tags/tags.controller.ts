import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { TagsService } from './tags.service';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { GetTagsDto, TagPaginator } from './dto/get-tags.dto';
import { SuperAdminOnly } from '../auth/super-admin-only.decorator';
import { Public } from '../auth/public.decorator';
import { SensitiveAction } from '../auth/step-up';

@Controller('tags')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @SuperAdminOnly()
  @Post()
  create(@Body() createTagDto: CreateTagDto) {
    return this.tagsService.create(createTagDto);
  }

  @Public()
  @Get()
  async findAll(@Query() query: GetTagsDto): Promise<TagPaginator> {
    return this.tagsService.findAll(query);
  }

  @Public()
  @Get(':param')
  findOne(@Param('param') param: string, @Query('language') language: string) {
    return this.tagsService.findOne(param, language);
  }

  @SuperAdminOnly()
  @Put(':id')
  update(@Param('id') id: string, @Body() updateTagDto: UpdateTagDto) {
    return this.tagsService.update(+id, updateTagDto);
  }

  @SuperAdminOnly()
  @SensitiveAction() // audit 3.1 : code redemandé
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.tagsService.remove(+id);
  }
}

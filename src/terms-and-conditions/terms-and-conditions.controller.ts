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
import { TermsAndConditionsService } from './terms-and-conditions.service';
import { GetTermsAndConditionsDto } from './dto/get-terms-and-conditions.dto';
import { CreateTermsAndConditionsDto } from './dto/create-terms-and-conditions.dto';
import { UpdateTermsAndConditionsDto } from './dto/update-terms-and-conditions.dto';
import { SuperAdminOnly } from '../auth/super-admin-only.decorator';
import { Public } from '../auth/public.decorator';

@Controller('terms-and-conditions')
export class TermsAndConditionsController {
  constructor(private termsAndConditionsService: TermsAndConditionsService) {}

  @SuperAdminOnly()
  @Post()
  createTermsAndConditions(
    @Body() createTermsAndConditionsDto: CreateTermsAndConditionsDto,
  ) {
    return this.termsAndConditionsService.create(createTermsAndConditionsDto);
  }

  @Public()
  @Get()
  getTermsAndConditions(@Query() query: GetTermsAndConditionsDto) {
    return this.termsAndConditionsService.findAllTermsAndConditions(query);
  }

  @Public()
  @Get(':param')
  findOne(@Param('param') param: string, @Query('language') language: string) {
    return this.termsAndConditionsService.findOne(param, language);
  }

  @SuperAdminOnly()
  @Put(':id')
  updateTermsConditions(
    @Param('id') id: string,
    @Body() updateTermsAndConditionsDto: UpdateTermsAndConditionsDto,
  ) {
    return this.termsAndConditionsService.update(
      +id,
      updateTermsAndConditionsDto,
    );
  }

  @SuperAdminOnly()
  @Delete(':id')
  deleteTermsAndConditions(@Param('id') id: string) {
    return this.termsAndConditionsService.remove(+id);
  }
}

@Controller('disapprove-terms-and-conditions')
export class DisapproveTermsAndConditionController {
  constructor(private termsAndConditionsService: TermsAndConditionsService) {}

  @SuperAdminOnly()
  @Post()
  async disapproveTermsAndCondition(@Body('id') id) {
    return this.termsAndConditionsService.disapproveTermsAndCondition(id);
  }
}

@Controller('approve-terms-and-conditions')
export class ApproveTermsAndConditionController {
  constructor(private termsAndConditionsService: TermsAndConditionsService) {}

  @SuperAdminOnly()
  @Post()
  async approveTermsAndCondition(@Body('id') id) {
    return this.termsAndConditionsService.approveTermsAndCondition(id);
  }
}

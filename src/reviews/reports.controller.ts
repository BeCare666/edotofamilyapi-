import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { AbusiveReportService } from './reports.service';
import { SuperAdminOnly } from '../auth/super-admin-only.decorator';

@Controller('abusive_reports')
export class AbusiveReportsController {
  constructor(private reportService: AbusiveReportService) {}

  @Get()
  async findAll() {
    return this.reportService.findAllReports();
  }

  // get single feedback
  @Get(':id')
  find(@Param('id') id: number) {
    return this.reportService.findReport(id);
  }

  // create a new feedback
  @SuperAdminOnly()
  @Post()
  create(@Body() createReportDto: CreateReportDto) {
    return this.reportService.create(createReportDto);
  }

  // update a feedback
  @SuperAdminOnly()
  @Put(':id')
  update(@Param('id') id: string, @Body() updateReportDto: UpdateReportDto) {
    return this.reportService.update(+id, updateReportDto);
  }

  // delete a feedback
  @SuperAdminOnly()
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.reportService.delete(+id);
  }
}

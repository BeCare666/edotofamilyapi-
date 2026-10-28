import { StrictDto } from 'src/common/strict-body';
import { CreateReportDto } from './create-report.dto';

@StrictDto()
export class UpdateReportDto extends CreateReportDto { }

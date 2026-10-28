import { StrictDto } from 'src/common/strict-body';
import { CreateTaxDto } from './create-tax.dto';

@StrictDto()
export class UpdateTaxDto extends CreateTaxDto {}

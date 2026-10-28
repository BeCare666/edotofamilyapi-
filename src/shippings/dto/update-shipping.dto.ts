import { StrictDto } from 'src/common/strict-body';
import { CreateShippingDto } from './create-shipping.dto';

@StrictDto()
export class UpdateShippingDto extends CreateShippingDto {}

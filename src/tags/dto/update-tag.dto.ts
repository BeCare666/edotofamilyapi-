import { StrictDto } from 'src/common/strict-body';
import { CreateTagDto } from './create-tag.dto';

@StrictDto()
export class UpdateTagDto extends CreateTagDto {}

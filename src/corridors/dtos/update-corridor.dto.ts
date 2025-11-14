import { PartialType } from '@nestjs/mapped-types';
import { CreateCorridorDto } from './create-corridor.dto';

export class UpdateCorridorDto extends PartialType(CreateCorridorDto) { }

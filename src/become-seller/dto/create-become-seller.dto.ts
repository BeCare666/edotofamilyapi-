import { OmitType } from '@nestjs/swagger';
import { BecomeSeller } from '../entities/become-seller.entity';

export class CreateBecomeSellerDto {
  userId: number; // Id de l'utilisateur à passer depuis le front
}
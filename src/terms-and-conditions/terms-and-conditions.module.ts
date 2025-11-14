import { Module } from '@nestjs/common';
import {
  ApproveTermsAndConditionController,
  DisapproveTermsAndConditionController,
  TermsAndConditionsController,
} from './terms-and-conditions.controller';
import { TermsAndConditionsService } from './terms-and-conditions.service';
import { DatabaseModule } from 'src/database/database.module';
@Module({
  imports: [DatabaseModule], // 👈 ajouter ici 
  controllers: [
    TermsAndConditionsController,
    DisapproveTermsAndConditionController,
    ApproveTermsAndConditionController,
  ],
  providers: [TermsAndConditionsService],
})
export class TermsAndConditionsModule { }

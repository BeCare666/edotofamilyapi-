import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { TeleconsultationModule } from '../teleconsultation/teleconsultation.module';
import { ContraceptionAdminController, ContraceptionPublicController, ContraceptionYouthController } from './contraception.controller';
import { ContraceptionService } from './contraception.service';

// Adoption des contraceptifs (21/10/2026) : fiches, demandes en 7 étapes, suivi.
// Migration : 015_contraception.sql (npm run db:setup). Étapes 3 à 6 : téléconsultation.
@Module({
  imports: [DatabaseModule, TeleconsultationModule],
  controllers: [ContraceptionPublicController, ContraceptionYouthController, ContraceptionAdminController],
  providers: [ContraceptionService],
})
export class ContraceptionModule {}

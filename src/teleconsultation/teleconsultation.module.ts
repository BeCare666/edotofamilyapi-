import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { TcAdminController, TcCenterController, TcDoctorController, TcPatientController, TcPublicController } from './teleconsultation.controller';
import { TeleconsultationService } from './teleconsultation.service';
import { TcAdminService } from './tc-admin.service';
import { TcRemindersCron } from './tc-reminders.cron';

// Téléconsultation (19/10/2026) : rendez-vous visio ou appel, comptes médecins et centres,
// comptes rendus, orientation par code QR. Migration : 013_teleconsultation.sql (npm run db:setup).
@Module({
  imports: [DatabaseModule],
  controllers: [TcPublicController, TcPatientController, TcDoctorController, TcCenterController, TcAdminController],
  providers: [TeleconsultationService, TcAdminService, TcRemindersCron],
  // Utilisé par l'adoption des contraceptifs (orientation vers un centre)
  exports: [TeleconsultationService],
})
export class TeleconsultationModule {}

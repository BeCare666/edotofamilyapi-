import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ContraceptionReminderController, PushController } from './push.controller';
import { PushCron } from './push.cron';

// Notifications push (04/11/2026). Les autres modules envoient directement par push-sender.ts
// (pushToUser, pushToOrderCustomer), sans attendre : une notification ne bloque jamais l'action d'origine.
@Module({
  imports: [DatabaseModule],
  controllers: [PushController, ContraceptionReminderController],
  providers: [PushCron],
})
export class PushModule {}

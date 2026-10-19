import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.services';
import { REMINDER_MINUTES } from './tc-rules';
import { mail, phoneReminderSms, sendSms, videoReminderEmail } from './tc-notify';
import { iso } from './tc-db';

// Rappels « à moins de 10 min » du début (19/10/2026) : visio = e-mail avec le lien, appel = SMS Brevo.
// Chaque rappel est « réservé » en base avant l'envoi : jamais deux rappels, même avec deux serveurs.
// TC_REMINDERS=off désactive l'envoi (ex. API lancée en local sur la base de production).
@Injectable()
export class TcRemindersCron {
  private readonly logger = new Logger('Téléconsultation');
  private running = false;

  constructor(private readonly db: DatabaseService) {}

  @Cron('* * * * *')
  async tick() {
    if (String(process.env.TC_REMINDERS || '').toLowerCase() === 'off' || this.running) return;
    this.running = true;
    try {
      const pool: any = this.db.getPool();
      const [rows]: any = await pool.query(
        `SELECT a.id, a.reference, a.mode, a.room, a.patient_name, a.patient_email, a.patient_phone, ${iso('a.starts_at')},
                d.name AS doctor_name, d.title AS doctor_title
         FROM tc_appointments a JOIN tc_doctors d ON d.id = a.doctor_id
         WHERE a.status = 'booked'
           AND a.starts_at > UTC_TIMESTAMP() AND a.starts_at <= DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE)
           AND ((a.mode = 'video' AND a.reminder_email_at IS NULL) OR (a.mode = 'phone' AND a.reminder_sms_at IS NULL))
         LIMIT 50`,
        [REMINDER_MINUTES],
      );
      for (const a of rows) {
        const col = a.mode === 'video' ? 'reminder_email_at' : 'reminder_sms_at';
        const [claim]: any = await pool.query(`UPDATE tc_appointments SET ${col} = UTC_TIMESTAMP() WHERE id = ? AND ${col} IS NULL`, [a.id]);
        if (!claim?.affectedRows) continue;
        try {
          if (a.mode === 'video') await mail(a.patient_email, `Votre téléconsultation commence bientôt (${a.reference})`, videoReminderEmail(a));
          else await sendSms(a.patient_phone, phoneReminderSms(a));
          await pool.query(`UPDATE tc_appointments SET reminder_error = NULL WHERE id = ?`, [a.id]);
        } catch (e: any) {
          const reason = String(e?.message || e).slice(0, 290);
          this.logger.error(`Rappel ${a.reference} non envoyé : ${reason}`);
          await pool.query(`UPDATE tc_appointments SET reminder_error = ? WHERE id = ?`, [reason, a.id]);
        }
      }
    } catch (e: any) {
      this.logger.error(`Rappels : ${e?.message || e}`);
    } finally {
      this.running = false;
    }
  }
}

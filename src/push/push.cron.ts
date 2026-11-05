import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.services';
import { PUSH } from './push-messages';
import { pushToAll, pushToUser } from './push-sender';
import { beninNow, isDue, Rhythm } from './reminder-rules';

// Envois programmés des notifications push (04/11/2026, rapports/PLAN_NOTIFICATIONS_PUSH.md, étape 1.6).
//  - rappel contraception (décision D4) : chaque minute ;
//  - nouvelle campagne : une seule fois, le jour où elle commence, à partir de 8 h (heure du Bénin), à tous les abonnés.
// Chaque envoi est « réservé » en base avant de partir : jamais deux fois, même avec deux serveurs.
// PUSH_CRON=off désactive ces envois (ex. API lancée en local sur la base de production).
const CAMPAIGN_FROM_MIN = 8 * 60;

@Injectable()
export class PushCron {
  private readonly logger = new Logger('Notifications');
  private runningReminders = false;
  private runningCampaigns = false;

  constructor(private readonly db: DatabaseService) {}

  private off() {
    return String(process.env.PUSH_CRON || '').toLowerCase() === 'off';
  }

  @Cron('* * * * *')
  async reminders() {
    if (this.off() || this.runningReminders) return;
    this.runningReminders = true;
    try {
      const pool: any = this.db.getPool();
      const now = new Date();
      let lastId = 0;
      for (;;) {
        const [rows]: any = await pool.query(
          `SELECT r.user_id, r.rhythm, r.time_hm, DATE_FORMAT(r.start_date, '%Y-%m-%d') AS start_date,
                  DATE_FORMAT(r.last_sent_at, '%Y-%m-%dT%H:%i:%sZ') AS last_sent_at
           FROM contraception_reminders r
           WHERE r.active = 1 AND r.user_id > ?
             AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = r.user_id)
           ORDER BY r.user_id LIMIT 500`,
          [lastId],
        );
        if (!rows?.length) break;
        lastId = rows[rows.length - 1].user_id;
        for (const r of rows) {
          const due = isDue(
            { rhythm: r.rhythm as Rhythm, time_hm: r.time_hm, start_date: r.start_date, active: true, last_sent_at: r.last_sent_at ? new Date(r.last_sent_at) : null },
            now,
          );
          if (!due) continue;
          const [claim]: any = await pool.query(
            `UPDATE contraception_reminders SET last_sent_at = UTC_TIMESTAMP(), active = IF(rhythm = 'once', 0, active)
             WHERE user_id = ? AND (last_sent_at <=> ?)`,
            [r.user_id, r.last_sent_at ? r.last_sent_at.replace('T', ' ').replace('Z', '') : null],
          );
          if (!claim?.affectedRows) continue;
          await pushToUser(pool, r.user_id, PUSH.reminder());
        }
      }
    } catch (e: any) {
      this.logger.error(`Rappels : ${e?.message || e}`);
    } finally {
      this.runningReminders = false;
    }
  }

  @Cron('*/5 * * * *')
  async campaigns() {
    if (this.off() || this.runningCampaigns) return;
    const { date, minutes } = beninNow(new Date());
    if (minutes < CAMPAIGN_FROM_MIN) return;
    this.runningCampaigns = true;
    try {
      const pool: any = this.db.getPool();
      const [rows]: any = await pool.query(
        `SELECT id FROM campaigns
         WHERE push_sent_at IS NULL AND date_start <= ? AND (date_end IS NULL OR date_end >= ?)
         ORDER BY date_start, id LIMIT 5`,
        [date, date],
      );
      for (const c of rows || []) {
        const [claim]: any = await pool.query(`UPDATE campaigns SET push_sent_at = UTC_TIMESTAMP() WHERE id = ? AND push_sent_at IS NULL`, [c.id]);
        if (!claim?.affectedRows) continue;
        const sent = await pushToAll(pool, PUSH.newCampaign());
        this.logger.log(`Campagne ${c.id} annoncée à ${sent} appareil(s).`);
      }
    } catch (e: any) {
      this.logger.error(`Campagnes : ${e?.message || e}`);
    } finally {
      this.runningCampaigns = false;
    }
  }
}

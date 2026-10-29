import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../../database/database.services';

// Conservation du journal du chat IA (audit sécurité 2.5, 29/10/2026) : 90 jours, puis suppression.
// Chaque nuit à 3 h (heure du serveur), par paquets pour ne pas bloquer la base.
export const AI_LOG_RETENTION_DAYS = 90;

@Injectable()
export class AiChatRetentionCron {
  private readonly logger = new Logger('Chat IA');

  constructor(private readonly db: DatabaseService) {}

  @Cron('0 3 * * *')
  async purge(): Promise<number> {
    let total = 0;
    try {
      const pool: any = this.db.getPool();
      for (let i = 0; i < 50; i++) {
        const [res]: any = await pool.query(
          `DELETE FROM ai_chat_logs WHERE created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY) LIMIT 1000`,
          [AI_LOG_RETENTION_DAYS],
        );
        total += Number(res?.affectedRows || 0);
        if (!res?.affectedRows || res.affectedRows < 1000) break;
      }
      if (total) this.logger.log(`Journal du chat IA : ${total} échange(s) de plus de ${AI_LOG_RETENTION_DAYS} jours supprimé(s).`);
    } catch (err: any) {
      this.logger.error(`Purge du journal du chat IA impossible : ${err?.message}`);
    }
    return total;
  }
}

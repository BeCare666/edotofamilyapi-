import { BadRequestException, Body, Controller, Delete, Get, HttpException, HttpStatus, Put, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CUSTOMER, Roles } from '../auth/roles.decorator';
import { Public } from '../auth/public.decorator';
import { allowAttempt } from '../sponsors/sponsor-rules';
import { DatabaseService } from '../database/database.services';
import { endpointHash, pushPublicKey, pushToUser, readPushPreferences } from './push-sender';
import { PUSH, PUSH_TOPICS } from './push-messages';
import { ContraceptionReminderDto, PushPreferencesDto, PushSubscribeDto, PushUnsubscribeDto } from './push-body.dto';
import { isDue, isValidDate, parseTime, Rhythm, RHYTHMS } from './reminder-rules';

// Notifications push (04/11/2026, rapports/PLAN_NOTIFICATIONS_PUSH.md, étapes 1.4 et 1.4 bis)

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim() : '').slice(0, max + 1);

@Controller('push')
export class PushController {
  constructor(private readonly db: DatabaseService) {}

  // Clé publique VAPID : le navigateur en a besoin pour s'abonner (elle n'est pas secrète)
  @Public()
  @Get('public-key')
  publicKey() {
    return { key: pushPublicKey() };
  }

  // Compte connecté (tout rôle) : enregistre cet appareil
  @UseGuards(JwtAuthGuard)
  @Post('subscribe')
  async subscribe(@Req() req: any, @Body() body: PushSubscribeDto) {
    const userId = Number(req.user.id);
    if (!allowAttempt(`push-sub:${userId}`, 20, 60 * 60 * 1000)) {
      throw new HttpException('Trop de tentatives. Réessayez dans une heure.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const endpoint = str(body?.endpoint, 600);
    const p256dh = str(body?.p256dh, 200);
    const auth = str(body?.auth, 100);
    if (!/^https:\/\/[^\s]+$/.test(endpoint) || endpoint.length > 600 || !/^[A-Za-z0-9_=-]{20,200}$/.test(p256dh) || !/^[A-Za-z0-9_=-]{8,100}$/.test(auth)) {
      throw new BadRequestException('Abonnement aux notifications invalide.');
    }
    const pool: any = this.db.getPool();
    // Même appareil : rattaché au compte connecté (un téléphone partagé ne reçoit que les notifications du dernier compte)
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, endpoint_hash, p256dh, auth) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), endpoint = VALUES(endpoint), p256dh = VALUES(p256dh), auth = VALUES(auth)`,
      [userId, endpoint, endpointHash(endpoint), p256dh, auth],
    );
    // Confirmation sur l'appareil : la personne voit tout de suite que cela fonctionne.
    // Pas pour le renvoi discret du site (correction A2, 05/11/2026), qui ne fait que remettre la ligne en place.
    if (body?.resync !== true) void pushToUser(pool, userId, PUSH.test());
    return { success: true };
  }

  // Choix des notifications par sujet (05/11/2026, décision P4) : le compte connecté ne lit et ne change que les siens
  @UseGuards(JwtAuthGuard)
  @Get('preferences')
  async preferences(@Req() req: any) {
    return readPushPreferences(this.db.getPool(), Number(req.user.id));
  }

  @UseGuards(JwtAuthGuard)
  @Put('preferences')
  async savePreferences(@Req() req: any, @Body() body: PushPreferencesDto) {
    const userId = Number(req.user.id);
    if (!allowAttempt(`push-pref:${userId}`, 60, 60 * 60 * 1000)) {
      throw new HttpException('Trop de tentatives. Réessayez dans une heure.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const pool: any = this.db.getPool();
    const current = await readPushPreferences(pool, userId);
    const next: Record<string, number> = {};
    for (const t of PUSH_TOPICS) {
      const v = (body as any)?.[t];
      if (v !== undefined && typeof v !== 'boolean') throw new BadRequestException('Choix invalide.');
      next[t] = (v === undefined ? current[t] : v) ? 1 : 0;
    }
    await pool.query(
      `INSERT INTO push_preferences (user_id, orders, appointments, campaigns) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE orders = VALUES(orders), appointments = VALUES(appointments), campaigns = VALUES(campaigns)`,
      [userId, next.orders, next.appointments, next.campaigns],
    );
    return readPushPreferences(pool, userId);
  }

  // Compte connecté : retire cet appareil (seulement s'il est à lui)
  @UseGuards(JwtAuthGuard)
  @Delete('subscribe')
  async unsubscribe(@Req() req: any, @Body() body: PushUnsubscribeDto) {
    const endpoint = str(body?.endpoint, 600);
    if (!endpoint) throw new BadRequestException('Appareil inconnu.');
    await this.db.getPool().query(
      `DELETE FROM push_subscriptions WHERE endpoint_hash = ? AND user_id = ?`,
      [endpointHash(endpoint), Number(req.user.id)],
    );
    return { success: true };
  }
}

// Rappel contraception à rythme libre (décision D4) : la personne ne lit et ne modifie que le sien
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(CUSTOMER)
@Controller('contraception/me/reminder')
export class ContraceptionReminderController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async get(@Req() req: any) {
    const [[row]]: any = await this.db.getPool().query(
      `SELECT rhythm, time_hm, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, active FROM contraception_reminders WHERE user_id = ?`,
      [Number(req.user.id)],
    );
    return row ? { rhythm: row.rhythm, time_hm: row.time_hm, start_date: row.start_date, active: Number(row.active) === 1 } : null;
  }

  @Put()
  async save(@Req() req: any, @Body() body: ContraceptionReminderDto) {
    const userId = Number(req.user.id);
    if (!allowAttempt(`contra-rem:${userId}`, 30, 60 * 60 * 1000)) {
      throw new HttpException('Trop de tentatives. Réessayez dans une heure.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const rhythm = str(body?.rhythm, 16);
    const time = str(body?.time_hm, 5);
    const start = str(body?.start_date, 10);
    if (!(RHYTHMS as readonly string[]).includes(rhythm)) throw new BadRequestException('Choisissez un rythme.');
    if (parseTime(time) === null) throw new BadRequestException('Heure invalide.');
    if (!isValidDate(start)) throw new BadRequestException('Date de départ invalide.');
    // Heure du jour déjà passée au moment du réglage : pas de rappel immédiat, on commence au prochain
    const now = new Date();
    const skipToday = isDue({ rhythm: rhythm as Rhythm, time_hm: time, start_date: start, active: true, last_sent_at: null }, now);
    await this.db.getPool().query(
      `INSERT INTO contraception_reminders (user_id, rhythm, time_hm, start_date, active, last_sent_at)
       VALUES (?, ?, ?, ?, 1, IF(?, UTC_TIMESTAMP(), NULL))
       ON DUPLICATE KEY UPDATE rhythm = VALUES(rhythm), time_hm = VALUES(time_hm), start_date = VALUES(start_date), active = 1, last_sent_at = VALUES(last_sent_at)`,
      [userId, rhythm, time, start, skipToday ? 1 : 0],
    );
    return this.get(req);
  }

  @Delete()
  async stop(@Req() req: any) {
    await this.db.getPool().query(`DELETE FROM contraception_reminders WHERE user_id = ?`, [Number(req.user.id)]);
    return { success: true };
  }
}

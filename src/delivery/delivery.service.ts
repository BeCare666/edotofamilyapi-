import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios from 'axios';
import { DatabaseService } from '../database/database.services';
import {
  computeFee,
  CustomDeliveryInput,
  DeliverySettings,
  generateCourierCredentials,
  isDeliveryConfigured,
  MAX_FAILED_ATTEMPTS,
  normalizePhone,
  parseCoordinates,
  parseDeviceId,
  parseSettingsInput,
  pinMatches,
  sha256,
  whatsappUrl,
} from './delivery-rules';

// Itinéraire OSRM (même serveur que la carte du site client).
// Sans OSRM_CAR_URL : serveur de démonstration FOSSGIS, réservé au DÉVELOPPEMENT
// (usage non commercial, 1 requête/s, sans garantie). En production : notre propre serveur OSRM.
const DEMO_OSRM_CAR_URL = 'https://routing.openstreetmap.de/routed-car/route/v1/driving';

const LIST_FILTERS: Record<string, string> = {
  to_assign: 'AND cd.assigned_at IS NULL AND cd.delivered_at IS NULL',
  in_progress: 'AND cd.assigned_at IS NOT NULL AND cd.delivered_at IS NULL',
  delivered: 'AND cd.delivered_at IS NOT NULL',
};

const INVALID_LINK = 'Lien de livraison invalide ou expiré.';

function toNumberOrNull(v: any): number | null {
  return v === null || v === undefined ? null : Number(v);
}

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(private readonly db: DatabaseService) { }

  // =========================
  // RÉGLAGES (admin)
  // =========================
  async getSettings(): Promise<DeliverySettings> {
    const [rows]: any = await this.db.getPool().query(
      `SELECT price_per_km, center_lat, center_lng FROM delivery_settings WHERE id = 1 LIMIT 1`,
    );
    const row = rows?.[0] || {};
    return {
      price_per_km: toNumberOrNull(row.price_per_km),
      center_lat: toNumberOrNull(row.center_lat),
      center_lng: toNumberOrNull(row.center_lng),
    };
  }

  async updateSettings(body: any): Promise<DeliverySettings> {
    const s = parseSettingsInput(body);
    await this.db.getPool().query(
      `INSERT INTO delivery_settings (id, price_per_km, center_lat, center_lng) VALUES (1, ?, ?, ?)
       ON DUPLICATE KEY UPDATE price_per_km = VALUES(price_per_km), center_lat = VALUES(center_lat),
                               center_lng = VALUES(center_lng)`,
      [s.price_per_km, s.center_lat, s.center_lng],
    );
    return this.getSettings();
  }

  // =========================
  // PRIX
  // =========================
  private async routeDistanceMeters(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
    const base = process.env.OSRM_CAR_URL || DEMO_OSRM_CAR_URL;
    if (!process.env.OSRM_CAR_URL) {
      this.logger.warn('OSRM_CAR_URL non défini : serveur OSRM de démonstration (développement uniquement).');
    }
    try {
      const res = await axios.get(`${base}/${from.lng},${from.lat};${to.lng},${to.lat}`, {
        params: { overview: 'false' },
        timeout: 15000,
      });
      const distance = res.data?.routes?.[0]?.distance;
      if (res.data?.code !== 'Ok' || !Number.isFinite(distance)) throw new Error(res.data?.code || 'NoRoute');
      return Number(distance);
    } catch (e: any) {
      this.logger.error(`Calcul d'itinéraire impossible : ${e?.message || e}`);
      throw new ServiceUnavailableException(
        "Impossible de calculer la distance de livraison pour le moment. Réessayez dans quelques instants.",
      );
    }
  }

  // Prix toujours calculé ici, jamais repris du client.
  async quote(lat: any, lng: any) {
    const to = parseCoordinates(lat, lng);
    const settings = await this.getSettings();
    if (!isDeliveryConfigured(settings)) {
      throw new ServiceUnavailableException("La livraison à domicile n'est pas encore disponible.");
    }
    const meters = await this.routeDistanceMeters({ lat: settings.center_lat, lng: settings.center_lng }, to);
    const { distance_km, fee } = computeFee(meters, settings.price_per_km);
    return { distance_km, price_per_km: settings.price_per_km, fee };
  }

  // Appelé dans la transaction de création de commande (OrdersService.create).
  async insertForOrder(conn: any, orderId: number, input: CustomDeliveryInput, q: { distance_km: number; price_per_km: number; fee: number }) {
    await conn.query(
      `INSERT INTO custom_deliveries (order_id, description, phone, lat, lng, distance_km, price_per_km, fee)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderId, input.description, input.phone, input.lat, input.lng, q.distance_km, q.price_per_km, q.fee],
    );
  }

  // Informations de livraison jointes à la commande (client / admin). Jamais d'empreinte de lien ou de PIN.
  async infoForOrder(orderId: number, relation: string | null) {
    const [rows]: any = await this.db.getPool().query(
      `SELECT description, phone, lat, lng, distance_km, price_per_km, fee, courier_name, courier_phone,
              assigned_at, delivered_at, link_blocked
       FROM custom_deliveries WHERE order_id = ? LIMIT 1`,
      [orderId],
    );
    const r = rows?.[0];
    if (!r) return null;
    const info: any = {
      description: r.description,
      phone: r.phone,
      lat: Number(r.lat),
      lng: Number(r.lng),
      distance_km: Number(r.distance_km),
      price_per_km: Number(r.price_per_km),
      fee: Number(r.fee),
      courier_assigned: !!r.assigned_at,
      delivered_at: r.delivered_at,
    };
    if (relation === 'admin') {
      Object.assign(info, { courier_name: r.courier_name, courier_phone: r.courier_phone, link_blocked: !!Number(r.link_blocked) });
    }
    return info;
  }

  // =========================
  // ADMIN : livraisons à gérer
  // =========================
  async adminList({ status, page = 1, limit = 20 }: { status?: string; page?: any; limit?: any }) {
    const pool = this.db.getPool();
    const pageNumber = Math.max(1, Number(page) || 1);
    const limitNumber = Math.min(100, Math.max(1, Number(limit) || 20));
    const filter = LIST_FILTERS[status as string] ?? '';
    const where = `o.payment_status = 'payment-success' ${filter}`;

    const [rows]: any = await pool.query(
      `SELECT cd.order_id, cd.description, cd.phone, cd.lat, cd.lng, cd.distance_km, cd.fee,
              cd.courier_name, cd.courier_phone, cd.assigned_at, cd.delivered_at, cd.link_blocked,
              cd.failed_attempts, (cd.link_token_hash IS NOT NULL) AS link_active,
              o.tracking_number, o.total, o.order_status, o.created_at, u.name AS customer_name
       FROM custom_deliveries cd
       JOIN orders o ON o.id = cd.order_id
       JOIN users u ON u.id = o.customer_id
       WHERE ${where}
       ORDER BY (cd.delivered_at IS NULL) DESC, o.created_at DESC
       LIMIT ? OFFSET ?`,
      [limitNumber, (pageNumber - 1) * limitNumber],
    );
    const [countRows]: any = await pool.query(
      `SELECT COUNT(*) AS total FROM custom_deliveries cd JOIN orders o ON o.id = cd.order_id WHERE ${where}`,
    );
    const total = Number(countRows?.[0]?.total || 0);
    return {
      data: rows.map((r: any) => ({
        ...r,
        lat: Number(r.lat),
        lng: Number(r.lng),
        distance_km: Number(r.distance_km),
        fee: Number(r.fee),
        total: Number(r.total),
        link_active: !!Number(r.link_active),
        link_blocked: !!Number(r.link_blocked),
      })),
      total,
      page: pageNumber,
      last_page: Math.max(1, Math.ceil(total / limitNumber)),
    };
  }

  private async loadForAdmin(orderId: number) {
    const [rows]: any = await this.db.getPool().query(
      `SELECT cd.id, cd.delivered_at, cd.assigned_at, o.tracking_number, o.payment_status, o.order_status, o.otp_used
       FROM custom_deliveries cd JOIN orders o ON o.id = cd.order_id
       WHERE cd.order_id = ? LIMIT 1`,
      [orderId],
    );
    const row = rows?.[0];
    if (!row) throw new NotFoundException('Livraison introuvable.');
    if (row.payment_status !== 'payment-success') throw new BadRequestException("Cette commande n'est pas payée.");
    if (row.delivered_at || Number(row.otp_used) === 1 || row.order_status === 'order-completed') {
      throw new BadRequestException('Ce colis a déjà été remis.');
    }
    if (['order-cancelled', 'order-refunded', 'order-failed'].includes(row.order_status)) {
      throw new BadRequestException('Cette commande ne peut plus être livrée.');
    }
    return row;
  }

  // Confier à un zem, ou générer un nouveau lien : nouveau lien + nouveau PIN,
  // appareil, compteur d'erreurs et blocage remis à zéro. Le lien et le PIN ne sont
  // renvoyés qu'ici, une seule fois (seules leurs empreintes sont stockées).
  async assign(orderId: number, body: any) {
    const row = await this.loadForAdmin(orderId);
    const courierName = typeof body?.courier_name === 'string' ? body.courier_name.trim() : '';
    if (!courierName || courierName.length > 100) throw new BadRequestException('Nom du zem obligatoire (100 caractères max).');
    const rawPhone = typeof body?.courier_phone === 'string' ? body.courier_phone.trim() : '';
    if (!rawPhone.startsWith('+')) {
      throw new BadRequestException('Téléphone du zem au format international obligatoire (ex. +229…), pour WhatsApp.');
    }
    const courierPhone = normalizePhone(rawPhone);

    const { token, pin, tokenHash, pinHash } = generateCourierCredentials();
    await this.db.getPool().query(
      `UPDATE custom_deliveries
       SET courier_name = ?, courier_phone = ?, link_token_hash = ?, pin_hash = ?, device_hash = NULL,
           failed_attempts = 0, link_blocked = 0, assigned_at = NOW()
       WHERE id = ? AND delivered_at IS NULL`,
      [courierName, courierPhone, tokenHash, pinHash, row.id],
    );

    const base = (process.env.FRONTEND_CALLBACK_URL || '').replace(/\/+$/, '');
    const link = `${base}/livraison/${token}`;
    const message =
      `Bonjour ${courierName}, livraison E·Doto (commande ${row.tracking_number}). ` +
      `Ouvrez ce lien sur votre téléphone et gardez-le pour vous : ${link} ` +
      `Le code PIN vous est donné par l'administrateur. Devant le client, demandez-lui son code de retrait.`;
    return { link, pin, whatsapp_url: whatsappUrl(courierPhone, message) };
  }

  async deactivate(orderId: number) {
    const row = await this.loadForAdmin(orderId);
    await this.db.getPool().query(
      `UPDATE custom_deliveries SET link_token_hash = NULL, pin_hash = NULL, device_hash = NULL WHERE id = ?`,
      [row.id],
    );
    return { success: true, message: 'Lien désactivé.' };
  }

  async unblock(orderId: number) {
    const row = await this.loadForAdmin(orderId);
    await this.db.getPool().query(
      `UPDATE custom_deliveries SET link_blocked = 0, failed_attempts = 0 WHERE id = ?`,
      [row.id],
    );
    return { success: true, message: 'Lien débloqué.' };
  }

  // =========================
  // LIEN DU ZEM (public, protégé par lien + appareil + PIN)
  // =========================
  private async loadByToken(token: string) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new NotFoundException(INVALID_LINK);
    const [rows]: any = await this.db.getPool().query(
      `SELECT cd.*, o.tracking_number, o.otp_code, o.otp_used, o.otp_expires_at, o.order_status, o.payment_status
       FROM custom_deliveries cd JOIN orders o ON o.id = cd.order_id
       WHERE cd.link_token_hash = ? LIMIT 1`,
      [sha256(token)],
    );
    const row = rows?.[0];
    if (!row || row.delivered_at || row.payment_status !== 'payment-success') throw new NotFoundException(INVALID_LINK);
    return row;
  }

  private checkDevice(row: any, deviceId: string) {
    if (Number(row.link_blocked) === 1) {
      throw new ForbiddenException("Lien bloqué après trop de codes incorrects. Contactez l'administrateur.");
    }
    if (row.device_hash && row.device_hash !== sha256(deviceId)) {
      throw new ForbiddenException('Ce lien est réservé au téléphone qui l’a ouvert en premier.');
    }
  }

  private async registerFailure(id: number) {
    const pool = this.db.getPool();
    await pool.query(`UPDATE custom_deliveries SET failed_attempts = failed_attempts + 1 WHERE id = ?`, [id]);
    await pool.query(
      `UPDATE custom_deliveries SET link_blocked = 1 WHERE id = ? AND failed_attempts >= ?`,
      [id, MAX_FAILED_ATTEMPTS],
    );
    const [rows]: any = await pool.query(`SELECT failed_attempts FROM custom_deliveries WHERE id = ?`, [id]);
    return Math.max(0, MAX_FAILED_ATTEMPTS - Number(rows?.[0]?.failed_attempts || 0));
  }

  private failureMessage(prefix: string, remaining: number) {
    return remaining > 0
      ? `${prefix} Il reste ${remaining} essai${remaining > 1 ? 's' : ''}.`
      : `${prefix} Lien bloqué : contactez l'administrateur.`;
  }

  // Première ouverture : le lien se verrouille sur cet appareil.
  async courierOpen(token: string, deviceIdRaw: any) {
    const deviceId = parseDeviceId(deviceIdRaw);
    const row = await this.loadByToken(token);
    if (!row.device_hash) {
      await this.db.getPool().query(
        `UPDATE custom_deliveries SET device_hash = ? WHERE id = ? AND device_hash IS NULL`,
        [sha256(deviceId), row.id],
      );
      const [again]: any = await this.db.getPool().query(`SELECT device_hash FROM custom_deliveries WHERE id = ?`, [row.id]);
      row.device_hash = again?.[0]?.device_hash;
    }
    this.checkDevice(row, deviceId);
    return { success: true, tracking_number: row.tracking_number };
  }

  private async unlocked(token: string, deviceIdRaw: any, pin: any) {
    const deviceId = parseDeviceId(deviceIdRaw);
    const row = await this.loadByToken(token);
    if (!row.device_hash) throw new ForbiddenException('Ouvrez d’abord le lien sur votre téléphone.');
    this.checkDevice(row, deviceId);
    if (!pinMatches(token, pin, row.pin_hash)) {
      const remaining = await this.registerFailure(row.id);
      throw new BadRequestException(this.failureMessage('Code PIN incorrect.', remaining));
    }
    return row;
  }

  async courierUnlock(token: string, body: any) {
    const row = await this.unlocked(token, body?.device_id, body?.pin);
    return {
      tracking_number: row.tracking_number,
      courier_name: row.courier_name,
      description: row.description,
      phone: row.phone,
      lat: Number(row.lat),
      lng: Number(row.lng),
    };
  }

  // Remise : le zem saisit le code du client (même OTP que pour un point de retrait).
  async courierDeliver(token: string, body: any) {
    const row = await this.unlocked(token, body?.device_id, body?.pin);
    const otp = typeof body?.otp === 'string' ? body.otp.trim() : '';

    if (Number(row.otp_used) === 1) throw new BadRequestException('Ce code a déjà été utilisé.');
    if (row.otp_expires_at && new Date(row.otp_expires_at).getTime() < Date.now()) {
      throw new BadRequestException(
        'Le code du client a expiré. Le client doit générer un nouveau code depuis sa commande.',
      );
    }
    if (!otp || !row.otp_code || String(row.otp_code) !== otp) {
      const remaining = await this.registerFailure(row.id);
      throw new BadRequestException(this.failureMessage('Code du client incorrect.', remaining));
    }

    const pool = this.db.getPool();
    const [res]: any = await pool.query(
      `UPDATE orders SET order_status = 'order-completed', otp_used = 1, delivered_at = NOW()
       WHERE id = ? AND otp_used = 0`,
      [row.order_id],
    );
    if (!res?.affectedRows) throw new BadRequestException('Ce code a déjà été utilisé.');
    // Le lien expire après la remise
    await pool.query(
      `UPDATE custom_deliveries SET delivered_at = NOW(), link_token_hash = NULL, pin_hash = NULL WHERE id = ?`,
      [row.id],
    );
    return { success: true, message: 'Code valide : remettez le colis au client.', tracking_number: row.tracking_number };
  }
}

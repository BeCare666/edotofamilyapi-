import { createHash } from 'crypto';
import * as webpush from 'web-push';
import { PushMessage } from './push-messages';

// Envoi des notifications push (04/11/2026, rapports/PLAN_NOTIFICATIONS_PUSH.md).
// Clés VAPID dans l'environnement (Render) : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
// Sans ces clés, rien n'est envoyé et rien ne casse.
// Règle : une notification ne bloque jamais l'action d'origine (commande, paiement, rendez-vous) ;
// les appels se font sans attendre (pushToUser(...) sans await) et toute erreur est seulement notée.

let configured: boolean | null = null;

export function pushPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

function ready(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    configured = false;
    console.warn('[push] Clés VAPID absentes : notifications push désactivées.');
    return false;
  }
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:edotofamily@gmail.com', pub, priv);
    configured = true;
  } catch (e: any) {
    configured = false;
    console.error(`[push] Clés VAPID invalides : ${e?.message || e}`);
  }
  return configured;
}

export const endpointHash = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex');

type Sub = { id: number; endpoint: string; p256dh: string; auth: string };

async function sendTo(pool: any, subs: Sub[], msg: PushMessage): Promise<number> {
  const payload = JSON.stringify({ title: msg.title, body: msg.body, url: msg.url, tag: msg.tag || 'edoto' });
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: msg.ttl ?? 24 * 3600, urgency: 'normal' },
      );
      sent++;
      await pool.query(`UPDATE push_subscriptions SET last_success_at = UTC_TIMESTAMP() WHERE id = ?`, [s.id]);
    } catch (e: any) {
      const code = Number(e?.statusCode);
      if (code === 404 || code === 410) {
        // Abonnement expiré ou désactivé dans le navigateur : supprimé
        await pool.query(`DELETE FROM push_subscriptions WHERE id = ?`, [s.id]).catch(() => undefined);
      } else {
        console.error(`[push] Envoi refusé (abonnement ${s.id}) : ${code || ''} ${String(e?.body || e?.message || e).slice(0, 200)}`);
      }
    }
  }
  return sent;
}

/** À tous les appareils d'un compte. Ne lève jamais d'erreur. */
export async function pushToUser(pool: any, userId: number | null | undefined, msg: PushMessage): Promise<number> {
  try {
    if (!userId || !ready()) return 0;
    const [subs]: any = await pool.query(
      `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?`,
      [Number(userId)],
    );
    return subs?.length ? await sendTo(pool, subs, msg) : 0;
  } catch (e: any) {
    console.error(`[push] ${e?.message || e}`);
    return 0;
  }
}

/** À tous les appareils abonnés (nouvelle campagne). Par lots pour ne pas tout charger d'un coup. */
export async function pushToAll(pool: any, msg: PushMessage): Promise<number> {
  let sent = 0;
  try {
    if (!ready()) return 0;
    let lastId = 0;
    for (;;) {
      const [subs]: any = await pool.query(
        `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE id > ? ORDER BY id LIMIT 200`,
        [lastId],
      );
      if (!subs?.length) break;
      sent += await sendTo(pool, subs, msg);
      lastId = subs[subs.length - 1].id;
    }
  } catch (e: any) {
    console.error(`[push] ${e?.message || e}`);
  }
  return sent;
}

/** Propriétaire d'une commande, puis notification. Ne lève jamais d'erreur. */
export async function pushToOrderCustomer(pool: any, orderId: number, msg: PushMessage): Promise<void> {
  try {
    const [[row]]: any = await pool.query(`SELECT customer_id FROM orders WHERE id = ? LIMIT 1`, [orderId]);
    await pushToUser(pool, row?.customer_id, msg);
  } catch (e: any) {
    console.error(`[push] ${e?.message || e}`);
  }
}

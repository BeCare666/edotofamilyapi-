import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.services';
import { TODAY_SQL } from '../campaigns/campaign-rules';

// Notifications de l'admin calculées à partir des données réelles (aucun texte inventé) :
// chaque élément renvoie vers l'écran où l'action se fait. La table « notifications » est vide
// et rien ne l'alimente : on ne s'en sert pas.
export type AdminNotification = {
  key: string; // identifiant stable (sert à savoir si l'admin l'a déjà vue)
  type: 'order' | 'paid_order' | 'delivery' | 'pickup_point' | 'sponsor_export' | 'stock' | 'registrations' | 'campaign';
  title: string;
  body: string;
  href: string;
  at: string | null; // date ISO de l'évènement
  action: boolean; // demande une action de l'admin
};

const RECENT_DAYS = 14;
const fcfa = (n: any) => `${Math.round(Number(n) || 0).toLocaleString('fr-FR')} FCFA`;
const iso = (d: any) => (d ? new Date(d).toISOString() : null);
const PAYMENT: Record<string, string> = {
  'payment-success': 'payée',
  'payment-pending': 'paiement en attente',
  'payment-failed': 'paiement échoué',
};

@Injectable()
export class AdminNotificationsService {
  constructor(private readonly db: DatabaseService) {}

  async list(): Promise<{ items: AdminNotification[]; generated_at: string }> {
    const pool = this.db.getPool();
    const [
      [newOrders],
      [paidOrders],
      [deliveries],
      [points],
      [exportsPending],
      [stock],
      [registrations],
      [campaigns],
    ]: any = await Promise.all([
      pool.query(
        `SELECT id, tracking_number, total, payment_status, customer_name, created_at
         FROM orders WHERE is_archived = 0 AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${RECENT_DAYS} DAY)
         ORDER BY created_at DESC LIMIT 15`,
      ),
      // Payées mais pas encore retirées / livrées
      pool.query(
        `SELECT id, tracking_number, total, delivery_type, updated_at
         FROM orders WHERE is_archived = 0 AND payment_status = 'payment-success'
           AND order_status NOT IN ('order-completed', 'order-cancelled', 'order-refunded', 'order-failed')
         ORDER BY updated_at DESC LIMIT 15`,
      ),
      // Livraisons à domicile payées, pas encore confiées à un zem (même règle que l'écran Livraisons)
      pool.query(
        `SELECT o.id, o.tracking_number, cd.created_at
         FROM custom_deliveries cd JOIN orders o ON o.id = cd.order_id
         WHERE o.payment_status = 'payment-success' AND cd.assigned_at IS NULL AND cd.delivered_at IS NULL
         ORDER BY cd.created_at DESC LIMIT 15`,
      ),
      // Points de retrait inscrits, e-mail confirmé, en attente de validation
      pool.query(
        `SELECT id, name, created_at, updated_at FROM users
         WHERE role = 'super_pickuppoint' AND pickup_approved = 0 AND is_verified = 1
         ORDER BY created_at DESC LIMIT 15`,
      ),
      pool.query(
        `SELECT r.id, r.requested_at, c.title, s.name AS sponsor
         FROM sponsor_export_requests r
         JOIN campaigns c ON c.id = r.campaign_id
         LEFT JOIN sponsors s ON s.id = r.sponsor_id
         WHERE r.status = 'pending' ORDER BY r.requested_at DESC LIMIT 15`,
      ),
      // Stock : mêmes seuils que la liste des produits (rupture < 1, faible 1 à 9)
      pool.query(
        `SELECT id, name, slug, quantity, updated_at FROM products
         WHERE COALESCE(quantity, 0) < 10 ORDER BY quantity ASC, name LIMIT 15`,
      ),
      pool.query(
        `SELECT c.id, c.title, COUNT(*) AS n, MAX(r.id) AS last_id, MAX(r.created_at) AS last_at
         FROM campaign_registrations r JOIN campaigns c ON c.id = r.campaign_id
         WHERE r.created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${RECENT_DAYS} DAY)
         GROUP BY c.id, c.title ORDER BY last_at DESC LIMIT 10`,
      ),
      // Campagnes qui commencent ou se terminent dans les 3 jours (heure du Bénin)
      pool.query(
        `SELECT id, title, date_start, date_end,
                DATEDIFF(date_start, ${TODAY_SQL}) AS starts_in,
                DATEDIFF(date_end, ${TODAY_SQL}) AS ends_in
         FROM campaigns
         WHERE DATEDIFF(date_start, ${TODAY_SQL}) BETWEEN 0 AND 3
            OR (date_end IS NOT NULL AND DATEDIFF(date_end, ${TODAY_SQL}) BETWEEN 0 AND 3)
         ORDER BY date_start`,
      ),
    ]);

    const items: AdminNotification[] = [];
    for (const o of newOrders) {
      items.push({
        key: `order-${o.id}`,
        type: 'order',
        title: `Nouvelle commande ${o.tracking_number}`,
        body: `${fcfa(o.total)} · ${PAYMENT[o.payment_status] ?? o.payment_status}${o.customer_name ? ` · ${o.customer_name}` : ''}`,
        href: `/orders/${o.id}`,
        at: iso(o.created_at),
        action: false,
      });
    }
    for (const o of paidOrders) {
      items.push({
        key: `paid-${o.id}`,
        type: 'paid_order',
        title: `Commande payée à remettre : ${o.tracking_number}`,
        body: `${fcfa(o.total)} · ${o.delivery_type === 'CUSTOM' ? 'livraison à domicile' : 'retrait en point'}`,
        href: `/orders/${o.id}`,
        at: iso(o.updated_at),
        action: true,
      });
    }
    for (const d of deliveries) {
      items.push({
        key: `delivery-${d.id}`,
        type: 'delivery',
        title: 'Livraison à confier à un zem',
        body: `Commande ${d.tracking_number}`,
        href: '/custom-deliveries',
        at: iso(d.created_at),
        action: true,
      });
    }
    for (const p of points) {
      items.push({
        key: `pickup-${p.id}`,
        type: 'pickup_point',
        title: 'Point de retrait à valider',
        body: `${p.name} a confirmé son e-mail`,
        href: '/pickup-points',
        at: iso(p.updated_at ?? p.created_at),
        action: true,
      });
    }
    for (const r of exportsPending) {
      items.push({
        key: `export-${r.id}`,
        type: 'sponsor_export',
        title: "Demande d'export d'un sponsor",
        body: `${r.sponsor ?? 'Sponsor'} · ${r.title}`,
        href: '/sponsor-exports',
        at: iso(r.requested_at),
        action: true,
      });
    }
    for (const p of stock) {
      const q = Number(p.quantity ?? 0);
      items.push({
        key: `stock-${p.id}-${q}`,
        type: 'stock',
        title: q < 1 ? 'Produit en rupture de stock' : 'Stock faible',
        body: `${p.name} · ${q < 1 ? '0 en stock' : `${q} en stock`}`,
        href: `/products?search=${encodeURIComponent(p.name)}`,
        at: iso(p.updated_at),
        action: true,
      });
    }
    for (const r of registrations) {
      const n = Number(r.n);
      items.push({
        key: `reg-${r.id}-${r.last_id}`,
        type: 'registrations',
        title: `${n} nouvelle${n > 1 ? 's' : ''} inscription${n > 1 ? 's' : ''}`,
        body: `${r.title} · ${RECENT_DAYS} derniers jours`,
        href: `/campaigns/${r.id}`,
        at: iso(r.last_at),
        action: false,
      });
    }
    for (const c of campaigns) {
      const startsIn = c.starts_in == null ? null : Number(c.starts_in);
      const endsIn = c.ends_in == null ? null : Number(c.ends_in);
      const when = (d: number) => (d === 0 ? "aujourd'hui" : d === 1 ? 'demain' : `dans ${d} jours`);
      if (startsIn != null && startsIn >= 0 && startsIn <= 3) {
        items.push({ key: `camp-start-${c.id}`, type: 'campaign', title: `Campagne qui commence ${when(startsIn)}`, body: c.title, href: `/campaigns/${c.id}`, at: iso(c.date_start), action: false });
      }
      if (endsIn != null && endsIn >= 0 && endsIn <= 3) {
        items.push({ key: `camp-end-${c.id}`, type: 'campaign', title: `Campagne qui se termine ${when(endsIn)}`, body: c.title, href: `/campaigns/${c.id}`, at: iso(c.date_end), action: false });
      }
    }

    items.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
    return { items, generated_at: new Date().toISOString() };
  }
}

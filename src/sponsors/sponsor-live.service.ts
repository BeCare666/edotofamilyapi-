import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.services';
import { SponsorSpaceService } from './sponsor-space.service';
import { EVENT_LABELS, EVENT_TYPES, beninDay, todayBenin } from './sponsor-rules';

// Suivi en temps réel et analyses de l'espace sponsor (15/10/2026).
// Toutes les données viennent des inscriptions réelles (campaign_registrations) des campagnes du sponsor.
// Aucune donnée nominative : des comptes, des villes et les points de retrait (déjà publics sur le site).
const UTC_FMT = '%Y-%m-%d %H:%i:%s';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: Record<string, string> = { a_venir: 'À venir', en_cours: 'En cours', terminee: 'Terminée' };
const isoAt = (u: string | null) => (u ? `${u.replace(' ', 'T')}Z` : null);
const rate = (part: number, all: number) => (all ? Math.round((part / all) * 1000) / 10 : null);

@Injectable()
export class SponsorLiveService {
  constructor(
    private readonly db: DatabaseService,
    private readonly space: SponsorSpaceService,
  ) { }

  // Campagnes retenues : « campaign » (une campagne précise) ou « status » (défaut propre à chaque vue ; « all » = toutes)
  private async scope(sponsorId: number, query: any, defaultStatus: string) {
    let list = await this.space.campaignsOf(sponsorId);
    const id = Number(query?.campaign);
    if (Number.isInteger(id) && id > 0) {
      list = list.filter((c: any) => c.id === id);
      if (!list.length) throw new NotFoundException('Campagne introuvable.'); // campagne non soutenue : même réponse
      return list;
    }
    const status = query?.status === 'all' ? '' : query?.status || defaultStatus;
    if (STATUSES[status]) list = list.filter((c: any) => c.status === status);
    return list;
  }

  // Options réelles des filtres de l'espace
  async filters(sponsorId: number) {
    const list = await this.space.campaignsOf(sponsorId);
    const ids = list.map((c: any) => c.id);
    let points: any[] = [];
    if (ids.length) {
      const [rows]: any = await this.db.getPool().query(
        `SELECT pc.id, pc.name, COUNT(*) AS n FROM campaign_registrations r JOIN users pc ON CAST(pc.id AS CHAR) = r.pickup_center
         WHERE r.campaign_id IN (${ids.map(() => '?').join(',')}) GROUP BY pc.id, pc.name ORDER BY pc.name`,
        ids,
      );
      points = rows.map((r: any) => ({ value: String(r.id), label: r.name, count: Number(r.n) }));
    }
    const cities = new Map<string, number>();
    list.forEach((c: any) => c.cities.forEach((x: string) => cities.set(x, (cities.get(x) || 0) + 1)));
    return {
      campaigns: list.map((c: any) => ({ value: String(c.id), label: c.title, status: c.status })),
      statuses: Object.entries(STATUSES).map(([value, label]) => ({ value, label, count: list.filter((c: any) => c.status === value).length })),
      cities: [...cities.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([value, count]) => ({ value, label: value, count })),
      points,
    };
  }

  // Événements anonymes : inscription (created_at), code validé au point (verified_at), kit retiré (picked_up_at)
  private eventsSql(ids: number[]) {
    const inList = ids.map(() => '?').join(',');
    const sql = `SELECT 'registration' AS type, r.campaign_id, r.city, r.pickup_center, r.created_at AS at FROM campaign_registrations r WHERE r.campaign_id IN (${inList})
      UNION ALL SELECT 'validated', r.campaign_id, r.city, r.pickup_center, r.verified_at FROM campaign_registrations r WHERE r.campaign_id IN (${inList}) AND r.otp_used = 1 AND r.verified_at IS NOT NULL
      UNION ALL SELECT 'withdrawn', r.campaign_id, r.city, r.pickup_center, r.picked_up_at FROM campaign_registrations r WHERE r.campaign_id IN (${inList}) AND r.picked_up = 1 AND r.picked_up_at IS NOT NULL`;
    return { sql, params: [...ids, ...ids, ...ids] };
  }

  private mapEvent(e: any, titles: Map<number, string>) {
    return {
      type: e.type,
      label: EVENT_LABELS[e.type as keyof typeof EVENT_LABELS],
      campaign_id: Number(e.campaign_id),
      campaign_title: titles.get(Number(e.campaign_id)) ?? '',
      city: e.city || null,
      point_name: e.point_name || null,
      at: isoAt(e.at),
    };
  }

  // Carte en direct : villes des campagnes, points de retrait (GPS) avec leurs chiffres, activité du jour, derniers événements.
  // Défaut : campagnes en cours.
  async live(sponsorId: number, query: any, defaultStatus = 'en_cours') {
    const list = await this.scope(sponsorId, query, defaultStatus);
    const today = todayBenin();
    const zero = () => ({ registrations: 0, validated: 0, withdrawn: 0 });
    const base = {
      generated_at: new Date().toISOString(),
      campaigns: list.map((c: any) => ({
        id: c.id, title: c.title, status: c.status, status_label: c.status_label, cities: c.cities, date_start: c.date_start, date_end: c.date_end,
        objective_kits: c.objective_kits, registrations: c.registrations, validated: c.validated, withdrawn: c.withdrawn,
      })),
    };
    if (!list.length) return { ...base, totals: { ...zero(), objective_kits: 0 }, today: zero(), cities: [], points: [], recent: [] };

    const ids = list.map((c: any) => c.id);
    const pool = this.db.getPool();
    const [regs]: any = await pool.query(
      `SELECT r.campaign_id, r.city, r.pickup_center, r.otp_used, r.picked_up,
              DATE_FORMAT(r.created_at, '${UTC_FMT}') AS created, DATE_FORMAT(r.verified_at, '${UTC_FMT}') AS verified, DATE_FORMAT(r.picked_up_at, '${UTC_FMT}') AS picked
       FROM campaign_registrations r WHERE r.campaign_id IN (${ids.map(() => '?').join(',')})`,
      ids,
    );
    const centerIds = [...new Set<string>(regs.map((r: any) => String(r.pickup_center)).filter((v: string) => /^\d+$/.test(v)))];
    const centers = new Map<string, any>();
    if (centerIds.length) {
      const [rows]: any = await pool.query(
        `SELECT id, name, pickup_address, pickup_lat, pickup_lng FROM users WHERE id IN (${centerIds.map(() => '?').join(',')})`,
        centerIds.map(Number),
      );
      rows.forEach((r: any) => centers.set(String(r.id), r));
    }

    const todayCount = zero();
    const cities = new Map<string, any>();
    for (const c of list) {
      for (const city of c.cities) {
        const g = cities.get(city.toLowerCase()) ?? { city, campaigns: [] as string[], in_progress: false, ...zero() };
        if (!g.campaigns.includes(c.title)) g.campaigns.push(c.title);
        if (c.status === 'en_cours') g.in_progress = true;
        cities.set(city.toLowerCase(), g);
      }
    }
    const points = new Map<string, any>();
    const latest = (...v: (string | null)[]) => v.filter(Boolean).sort().pop() ?? null;
    for (const r of regs) {
      const validated = Number(r.otp_used) === 1;
      const withdrawn = Number(r.picked_up) === 1;
      if (r.created && beninDay(r.created) === today) todayCount.registrations++;
      if (validated && r.verified && beninDay(r.verified) === today) todayCount.validated++;
      if (withdrawn && r.picked && beninDay(r.picked) === today) todayCount.withdrawn++;

      const cityKey = String(r.city || '').toLowerCase();
      if (cityKey) {
        const g = cities.get(cityKey) ?? { city: r.city, campaigns: [], in_progress: false, ...zero() };
        g.registrations++;
        if (validated) g.validated++;
        if (withdrawn) g.withdrawn++;
        cities.set(cityKey, g);
      }

      const key = String(r.pickup_center);
      const center = centers.get(key);
      const num = (v: any) => (v === null || v === undefined || v === '' ? null : Number(v));
      const p = points.get(key) ?? {
        id: Number(key) || null,
        name: center?.name ?? 'Point inconnu',
        address: center?.pickup_address ?? null,
        lat: num(center?.pickup_lat),
        lng: num(center?.pickup_lng),
        ...zero(),
        today_withdrawn: 0,
        last_activity_at: null as string | null,
      };
      p.registrations++;
      if (validated) p.validated++;
      if (withdrawn) p.withdrawn++;
      if (withdrawn && r.picked && beninDay(r.picked) === today) p.today_withdrawn++;
      p.last_activity_at = latest(p.last_activity_at, r.created, r.verified, r.picked);
      points.set(key, p);
    }

    const ev = this.eventsSql(ids);
    const [recent]: any = await pool.query(
      `SELECT e.type, e.campaign_id, e.city, pc.name AS point_name, DATE_FORMAT(e.at, '${UTC_FMT}') AS at
       FROM (${ev.sql}) e LEFT JOIN users pc ON CAST(pc.id AS CHAR) = e.pickup_center
       ORDER BY e.at DESC LIMIT 15`,
      ev.params,
    );
    const titles = new Map<number, string>(list.map((c: any) => [c.id, c.title]));
    const sum = (f: (c: any) => number) => list.reduce((s: number, c: any) => s + f(c), 0);
    return {
      ...base,
      totals: { registrations: sum((c) => c.registrations), validated: sum((c) => c.validated), withdrawn: sum((c) => c.withdrawn), objective_kits: sum((c) => c.objective_kits) },
      today: todayCount,
      cities: [...cities.values()]
        .map((c) => ({ ...c, rate: rate(c.withdrawn, c.registrations) }))
        .sort((a, b) => b.registrations - a.registrations || a.city.localeCompare(b.city)),
      points: [...points.values()]
        .map((p) => ({ ...p, last_activity_at: isoAt(p.last_activity_at), rate: rate(p.withdrawn, p.registrations) }))
        .sort((a, b) => b.registrations - a.registrations || a.name.localeCompare(b.name)),
      recent: recent.map((e: any) => this.mapEvent(e, titles)),
    };
  }

  // Journal d'activité filtrable : campagne, statut, type, ville, point, période (jours à l'heure du Bénin), pagination
  async activity(sponsorId: number, query: any) {
    const list = await this.scope(sponsorId, query, '');
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(100, Math.max(5, Number(query?.limit) || 25));
    const counts: Record<string, number> = { registration: 0, validated: 0, withdrawn: 0 };
    if (!list.length) return { data: [], total: 0, page, limit, last_page: 1, counts, daily: [] };

    const ids = list.map((c: any) => c.id);
    const ev = this.eventsSql(ids);
    const where: string[] = [];
    const params: any[] = [...ev.params];
    const city = typeof query?.city === 'string' ? query.city.trim() : '';
    if (city) { where.push('LOWER(e.city) = LOWER(?)'); params.push(city); }
    const point = Number(query?.point);
    if (Number.isInteger(point) && point > 0) { where.push('e.pickup_center = ?'); params.push(String(point)); }
    // Jours du Bénin (UTC+1) convertis en bornes UTC
    const utc = (d: string, end: boolean) => new Date(Date.parse(`${d}T00:00:00Z`) - 3_600_000 + (end ? 86_400_000 : 0)).toISOString().slice(0, 19).replace('T', ' ');
    if (DATE_RE.test(query?.from || '')) { where.push('e.at >= ?'); params.push(utc(query.from, false)); }
    if (DATE_RE.test(query?.to || '')) { where.push('e.at < ?'); params.push(utc(query.to, true)); }
    const type = (EVENT_TYPES as readonly string[]).includes(query?.type) ? query.type : '';
    const baseWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const listWhere = type ? `${baseWhere ? `${baseWhere} AND` : 'WHERE'} e.type = ?` : baseWhere;
    const listParams = type ? [...params, type] : params;

    const pool = this.db.getPool();
    const from = `FROM (${ev.sql}) e LEFT JOIN users pc ON CAST(pc.id AS CHAR) = e.pickup_center`;
    const [[countRows], [rows], [dayRows]]: any = await Promise.all([
      pool.query(`SELECT e.type, COUNT(*) AS n ${from} ${baseWhere} GROUP BY e.type`, params),
      pool.query(
        `SELECT e.type, e.campaign_id, e.city, pc.name AS point_name, DATE_FORMAT(e.at, '${UTC_FMT}') AS at ${from} ${listWhere} ORDER BY e.at DESC LIMIT ? OFFSET ?`,
        [...listParams, limit, (page - 1) * limit],
      ),
      pool.query(`SELECT e.type, DATE_FORMAT(e.at, '${UTC_FMT}') AS at ${from} ${listWhere}`, listParams),
    ]);
    countRows.forEach((r: any) => (counts[r.type] = Number(r.n)));
    const total = type ? counts[type] : counts.registration + counts.validated + counts.withdrawn;
    const byDay = new Map<string, any>();
    for (const r of dayRows) {
      const d = beninDay(r.at);
      const g = byDay.get(d) ?? { date: d, registration: 0, validated: 0, withdrawn: 0 };
      g[r.type]++;
      byDay.set(d, g);
    }
    const titles = new Map<number, string>(list.map((c: any) => [c.id, c.title]));
    return {
      data: rows.map((e: any) => this.mapEvent(e, titles)),
      total,
      page,
      limit,
      last_page: Math.max(1, Math.ceil(total / limit)),
      counts,
      daily: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-60), // 60 derniers jours actifs
    };
  }

  // Points de retrait (tableau) : recherche, tri ; défaut : toutes les campagnes
  async points(sponsorId: number, query: any) {
    const live = await this.live(sponsorId, query, '');
    let rows = live.points;
    const q = typeof query?.q === 'string' ? query.q.trim().toLowerCase() : '';
    if (q) rows = rows.filter((p: any) => `${p.name} ${p.address ?? ''}`.toLowerCase().includes(q));
    const sorts: Record<string, (a: any, b: any) => number> = {
      withdrawn: (a, b) => b.withdrawn - a.withdrawn,
      rate: (a, b) => (b.rate ?? -1) - (a.rate ?? -1),
      recent: (a, b) => String(b.last_activity_at ?? '').localeCompare(String(a.last_activity_at ?? '')),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    if (sorts[query?.sort]) rows = [...rows].sort(sorts[query.sort]);
    return { generated_at: live.generated_at, total: live.points.length, data: rows };
  }

  // Villes (tableau) : tri ; défaut : toutes les campagnes
  async cities(sponsorId: number, query: any) {
    const live = await this.live(sponsorId, query, '');
    let rows = live.cities;
    const sorts: Record<string, (a: any, b: any) => number> = {
      withdrawn: (a, b) => b.withdrawn - a.withdrawn,
      rate: (a, b) => (b.rate ?? -1) - (a.rate ?? -1),
      name: (a, b) => a.city.localeCompare(b.city),
    };
    if (sorts[query?.sort]) rows = [...rows].sort(sorts[query.sort]);
    return { generated_at: live.generated_at, data: rows };
  }
}

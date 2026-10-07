import { DatabaseService } from '../../database/database.services';
import { CampaignsService } from '../../campaigns/campaigns.service';
import { toIsoDate } from '../../campaigns/campaign-rules';
import { EmergencyKind } from './ai-chat.safety';

// Outils de l'Assistant SSR. Les outils « E.doto family » lisent la base en LECTURE SEULE : ce sont
// les seules sources autorisées pour parler d'E.doto family (voir le prompt et ai-chat.guard.ts).

export const EMERGENCY_KINDS: EmergencyKind[] = ['suicide', 'violence', 'medical'];

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

const schema = (properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'get_catalog',
    description:
      'Renvoie la liste COMPLÈTE des produits vendus par E.doto family (nom, prix en FCFA, prix promotionnel, disponibilité, courte description). Un produit absent de cette liste n’est pas vendu par E.doto family.',
    input_schema: schema(),
  },
  {
    name: 'get_free_kit_campaigns',
    description:
      'Liste les campagnes de distribution de kits SSR gratuits en cours aujourd’hui, éventuellement dans une ville.',
    input_schema: schema({ city: { type: 'string', description: 'Ville (optionnel).' } }),
  },
  {
    name: 'get_delivery_info',
    description: 'Renvoie le tarif de livraison E.doto family et la façon dont il est calculé.',
    input_schema: schema(),
  },
  {
    name: 'get_pickup_points',
    description: 'Liste les points de retrait E.doto family actifs (nom et adresse).',
    input_schema: schema(),
  },
  {
    name: 'refer_to_ssr_expert',
    description:
      "Affiche à l'utilisateur une carte pour prendre un rendez-vous confidentiel avec un conseiller SSR d'E.doto family. À utiliser dès que tu n'es pas certain de la réponse, si l'information n'est fournie par aucun outil, si la personne demande à parler à quelqu'un, ou si sa situation mérite un accompagnement personnel.",
    input_schema: schema({ reason: { type: 'string', description: 'Raison courte (usage interne).' } }, ['reason']),
  },
  {
    name: 'signal_emergency',
    description:
      "Affiche un message d'aide validé par l'équipe quand la personne évoque des idées suicidaires (suicide), une violence subie (violence) ou un symptôme pouvant être une urgence médicale (medical).",
    input_schema: schema({ kind: { type: 'string', enum: EMERGENCY_KINDS } }, ['kind']),
  },
];

export const EDOTO_TOOLS = ['get_catalog', 'get_free_kit_campaigns', 'get_delivery_info', 'get_pickup_points'];

export interface CatalogProduct {
  name: string;
  slug: string;
  price: number | null;
  sale_price: number | null;
  available: boolean;
  image: string | null;
}

// Résultat d'un outil : `content` est renvoyé au modèle, `facts` est gardé pour le vérificateur.
export interface ToolOutput {
  content: string;
  is_error?: boolean;
  facts?: unknown;
  products?: CatalogProduct[];
  campaigns?: unknown[];
}

const stripHtml = (html: unknown) =>
  String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const num = (v: unknown) => (v == null ? null : Number(v));

export class EdotoData {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly campaignsService: CampaignsService,
  ) {}

  async catalog(): Promise<ToolOutput> {
    const [rows]: any[] = await this.databaseService.getPool().query(
      `SELECT name, slug, price, sale_price, in_stock, quantity, image, description FROM products
       WHERE status = 'publish' AND deleted_at IS NULL ORDER BY name LIMIT 200`,
    );
    const facts = rows.map((r: any) => ({
      nom: r.name,
      prix_fcfa: num(r.price),
      prix_promo_fcfa: num(r.sale_price),
      disponible: !!r.in_stock && Number(r.quantity) > 0,
      description: stripHtml(r.description).slice(0, 140),
    }));
    const products: CatalogProduct[] = rows.map((r: any) => ({
      name: r.name,
      slug: r.slug,
      price: num(r.price),
      sale_price: num(r.sale_price),
      available: !!r.in_stock && Number(r.quantity) > 0,
      image: imageUrl(r.image),
    }));
    return {
      content: facts.length ? JSON.stringify(facts) : 'Le catalogue E.doto family est vide pour le moment.',
      facts: { catalogue_complet: facts },
      products,
    };
  }

  async campaigns(city: string): Promise<ToolOutput> {
    const rows =
      (city
        ? await this.campaignsService.getActiveCampaignByCity(city)
        : await this.campaignsService.getActiveCampaign()) || [];
    const items = rows.slice(0, 5).map((c: any) => ({
      id: c.id,
      title: c.title,
      cities: c.cities,
      date_start: toIsoDate(c.date_start),
      date_end: toIsoDate(c.date_end),
    }));
    const facts = items.map(({ title, cities, date_start, date_end }) => ({ title, cities, date_start, date_end }));
    return {
      content: facts.length
        ? JSON.stringify(facts)
        : `Aucune campagne de kits gratuits en cours${city ? ` à ${city}` : ''}.`,
      facts: { campagnes_kits_gratuits_en_cours: facts, ville_demandee: city || null },
      campaigns: items,
    };
  }

  async delivery(): Promise<ToolOutput> {
    const [rows]: any[] = await this.databaseService
      .getPool()
      .query('SELECT price_per_km FROM delivery_settings ORDER BY id LIMIT 1');
    if (!rows.length) return { content: 'Aucune information de livraison disponible.', facts: { livraison: null } };
    const facts = {
      tarif_livraison: `${Number(rows[0].price_per_km)} FCFA par kilomètre`,
      calcul: 'selon la distance entre le centre de Cotonou et l’adresse de livraison ; le montant exact est affiché au moment de la commande',
      retrait_en_point_de_retrait: 'possible (liste donnée par get_pickup_points)',
    };
    return { content: JSON.stringify(facts), facts: { livraison: facts } };
  }

  async pickupPoints(): Promise<ToolOutput> {
    const [rows]: any[] = await this.databaseService.getPool().query(
      `SELECT name, pickup_address FROM users
       WHERE role = 'super_pickuppoint' AND pickup_approved = 1 AND is_active = 1 AND pickup_address IS NOT NULL
       ORDER BY name LIMIT 50`,
    );
    const facts = rows.map((r: any) => ({ nom: r.name, adresse: r.pickup_address }));
    return {
      content: facts.length ? JSON.stringify(facts) : 'Aucun point de retrait actif pour le moment.',
      facts: { points_de_retrait: facts },
    };
  }
}

export function imageUrl(raw: unknown): string | null {
  if (!raw) return null;
  let v: any = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return v;
    }
  }
  if (typeof v === 'string') return v;
  return v?.thumbnail || v?.original || null;
}

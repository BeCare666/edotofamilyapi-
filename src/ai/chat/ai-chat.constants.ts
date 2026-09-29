// Chat « IA Edotofamily » (santé sexuelle et reproductive) — décisions du 25/09/2026.
// Voir ROADMAP_IA_CHAT_SSR.md à la racine du projet.

export const AI_CHAT_MODEL = process.env.AI_CHAT_MODEL || 'claude-opus-5';
// Chat sensible à la latence : effort « medium » par défaut, ajustable sans redéploiement du code.
export const AI_CHAT_EFFORT = (process.env.AI_CHAT_EFFORT || 'medium') as 'low' | 'medium' | 'high';

export const CALENDLY_URL = 'https://calendly.com/edotofamily/30min';

export const CHAT_LANGS = ['fr', 'en', 'fon'] as const;
export type ChatLang = (typeof CHAT_LANGS)[number];

// Limites (chat ouvert à tous, sans connexion)
export const MAX_QUESTION_CHARS = 300;
export const MAX_ASSISTANT_CHARS = 4000; // réponses précédentes renvoyées par le client
export const MAX_HISTORY_MESSAGES = 10;
export const MAX_TOOL_ROUNDS = 4;
export const RATE_LIMIT_MAX = Number(process.env.AI_CHAT_RATE_LIMIT_MAX) || 20;
export const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

// Recherche web limitée à des sources officielles de santé (liste à valider par les pros de santé)
export const ALLOWED_WEB_DOMAINS = [
  'who.int',
  'unfpa.org',
  'unaids.org',
  'unicef.org',
  'ippf.org',
  'sante.gouv.bj',
  'sante.gouv.fr',
  'ameli.fr',
  'cdc.gov',
  'nhs.uk',
];

// Numéros d'urgence affichés en cas de détresse : À REMPLIR uniquement avec des numéros
// vérifiés par l'équipe (pas de numéro non vérifié sur un sujet d'urgence).
export const EMERGENCY_CONTACTS: { label: string; number: string }[] = [];

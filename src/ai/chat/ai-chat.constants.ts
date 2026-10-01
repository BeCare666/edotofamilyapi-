// Chat « Assistant SSR » (santé sexuelle et reproductive) — décisions du 25/09/2026.
// Voir ROADMAP_IA_CHAT_SSR.md et RAPPORT_IA_OPTION_GRATUITE.md à la racine du projet.

// Fournisseur de l'IA : « groq » (offre gratuite, choisie le 01/10/2026) ou « anthropic » (Claude, payant).
export const AI_CHAT_PROVIDER = (process.env.AI_CHAT_PROVIDER || 'groq') as 'groq' | 'anthropic';
export const AI_CHAT_MODEL = process.env.AI_CHAT_MODEL || 'claude-opus-5';
// Chat sensible à la latence : effort « medium » par défaut, ajustable sans redéploiement du code.
export const AI_CHAT_EFFORT = (process.env.AI_CHAT_EFFORT || 'medium') as 'low' | 'medium' | 'high';

export const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
// Le vérificateur tourne sur un autre modèle : chez Groq, chaque modèle a son propre quota gratuit.
export const GROQ_VERIFIER_MODEL = process.env.GROQ_VERIFIER_MODEL || 'openai/gpt-oss-20b';
export const GROQ_TIMEOUT_MS = 45_000;
// Au-delà de cette attente (quota par minute), on n'insiste pas : message « limite atteinte ».
export const GROQ_MAX_RETRY_WAIT_S = 8;

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

// Recherche web (Claude uniquement) limitée à des sources officielles de santé (liste à valider par les pros de santé)
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

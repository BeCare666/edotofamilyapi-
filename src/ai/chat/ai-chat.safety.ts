import { CALENDLY_URL, ChatLang, EMERGENCY_CONTACTS } from './ai-chat.constants';

export type EmergencyKind = 'suicide' | 'violence' | 'medical';

// Détection volontairement étroite (formulations à la première personne) : ces messages ne passent
// pas par la génération libre, ils reçoivent une réponse fixe. Les cas non détectés ici sont
// signalés par l'IA via l'outil signal_emergency.
// Pas de \b final : « é » n'est pas un caractère de mot pour \b, « violée » ne serait jamais reconnu.
const PATTERNS: [EmergencyKind, RegExp][] = [
  [
    'suicide',
    /\b(me suicider|me tuer|suicid\w*|en finir avec (ma|la) vie|plus envie de vivre|envie de mourir|kill myself|end my life|want to die|suicidal)/i,
  ],
  [
    'violence',
    /\b(on m'a violée?|j'ai été violée?|il m'a violée?|ils m'ont violée?|je me suis fait violer|agressée? sexuellement|abusée? sexuellement|i was raped|he raped me|sexually assaulted|sexually abused)/i,
  ],
  [
    'medical',
    /\b(je saigne (beaucoup|énormément|abondamment)|hémorragie|perdu connaissance|bleeding (heavily|a lot)|passed out)/i,
  ],
];

export function detectEmergency(text: string): EmergencyKind | null {
  for (const [kind, re] of PATTERNS) if (re.test(text)) return kind;
  return null;
}

const MESSAGES: Record<'fr' | 'en', Record<EmergencyKind, string>> = {
  fr: {
    suicide:
      "Ce que tu ressens compte, et tu n'es pas seul·e. Parle dès maintenant à une personne de confiance (parent, ami·e, enseignant·e) et contacte les services d'urgence ou rends-toi au centre de santé le plus proche. Si tu es en danger immédiat, n'attends pas.",
    violence:
      "Ce qui t'est arrivé n'est pas de ta faute. Mets-toi en sécurité, puis rends-toi rapidement dans un centre de santé : certains soins et traitements de prévention doivent être donnés le plus tôt possible (idéalement dans les 72 heures). Tu peux aussi en parler à une personne de confiance.",
    medical:
      "Ce que tu décris peut nécessiter une prise en charge urgente. Rends-toi immédiatement au centre de santé ou à l'hôpital le plus proche, ou contacte les services d'urgence.",
  },
  en: {
    suicide:
      "What you are feeling matters, and you are not alone. Talk right now to someone you trust (a parent, friend, teacher) and contact emergency services or go to the nearest health centre. If you are in immediate danger, do not wait.",
    violence:
      "What happened to you is not your fault. Get to a safe place, then go to a health centre as soon as possible: some care and preventive treatments must be given early (ideally within 72 hours). You can also talk to someone you trust.",
    medical:
      "What you describe may need urgent care. Go immediately to the nearest health centre or hospital, or contact emergency services.",
  },
};

export function emergencyPayload(kind: EmergencyKind, lang: ChatLang) {
  const l = lang === 'en' ? 'en' : 'fr';
  return {
    kind,
    message: MESSAGES[l][kind],
    contacts: EMERGENCY_CONTACTS,
    calendlyUrl: CALENDLY_URL,
  };
}

export const REFER_MESSAGE: Record<'fr' | 'en', string> = {
  fr: "Je ne connais pas la réponse avec certitude. Veuillez contacter un expert SSR d'E.doto family, il pourra vous répondre en toute confidentialité.",
  en: "I don't know the answer with certainty. Please contact an E.doto family SRH expert, who can answer you confidentially.",
};

// Quota gratuit du fournisseur d'IA épuisé : message clair plutôt qu'une erreur « Réessaie ».
export const QUOTA_MESSAGE: Record<'fr' | 'en', string> = {
  fr: "L'Assistant SSR a atteint sa limite de questions pour aujourd'hui. Reviens demain, ou prends dès maintenant un rendez-vous confidentiel avec un conseiller E.doto family.",
  en: 'The SRH Assistant has reached its question limit for today. Come back tomorrow, or book a confidential appointment with an E.doto family counsellor now.',
};

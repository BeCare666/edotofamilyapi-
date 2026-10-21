import { BadRequestException } from '@nestjs/common';

// Adoption des contraceptifs (21/10/2026) : règles pures, sans base de données.
//
// Statuts d'une demande :
//   pending      étape 1 faite, attente de l'acceptation (étape 2)
//   refused      refusée à l'étape 2 (fin)
//   accepted     acceptée ; avec médecin : le jeune prend rendez-vous (étape 3)
//   meeting      rendez-vous pris avec un médecin (étape 3 en cours)
//   not_adopted  le médecin conclut sans adoption (fin à l'étape 4)
//   center       adoption conclue, orientation vers un centre (étape 5)
//   not_done     le centre indique que l'adoption n'a pas été faite (fin à l'étape 6)
//   followup     adoption faite (étape 6) ; suivi avec rapports (étape 7)
//   cancelled    annulée par le jeune avant la rencontre (fin)

export const REQUEST_STATUSES = ['pending', 'refused', 'accepted', 'meeting', 'not_adopted', 'center', 'not_done', 'followup', 'cancelled'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const STATUS_LABEL: Record<RequestStatus, string> = {
  pending: 'Demande envoyée',
  refused: 'Demande refusée',
  accepted: 'Demande acceptée',
  meeting: 'Rencontre avec le médecin',
  not_adopted: 'Pas d’adoption',
  center: 'Passage au centre',
  not_done: 'Adoption non faite',
  followup: 'Adoption faite, suivi',
  cancelled: 'Demande annulée',
};

export const STEP_LABELS = [
  'Demande',
  'Demande acceptée',
  'Rencontre avec un médecin',
  'Adoption conclue',
  'Passage au centre recommandé',
  'Adoption faite',
  'Suivi',
];

export const CONCLUSIONS = ['adopt', 'other', 'no'] as const;
export const CONCLUSION_LABEL: Record<string, string> = {
  adopt: 'Adoption de la méthode',
  other: 'Une autre méthode est conseillée',
  no: 'Pas d’adoption pour le moment',
};

export const MAX_OPEN_REQUESTS = 3;
export const OPEN_STATUSES: RequestStatus[] = ['pending', 'accepted', 'meeting', 'center'];

export type StepState = 'done' | 'current' | 'todo' | 'skipped' | 'failed';
export type Step = { n: number; label: string; state: StepState; date: string | null; detail?: string | null };

type RequestLike = {
  status: RequestStatus;
  requires_doctor: number | boolean;
  created_at?: string | null;
  accepted_at?: string | null;
  refused_at?: string | null;
  concluded_at?: string | null;
  outcome_at?: string | null;
  appointment_starts_at?: string | null;
  referral_viewed_at?: string | null;
  cancelled_at?: string | null;
};

/** Les 7 étapes d'une demande, avec leur état (fait, en cours, à venir, sautée, échec) */
export function computeSteps(r: RequestLike): Step[] {
  const doctor = Number(r.requires_doctor) === 1;
  const s = r.status;
  const reached: Record<RequestStatus, number> = {
    pending: 2,
    refused: 2,
    cancelled: doctor ? 3 : 2,
    accepted: doctor ? 3 : 5,
    meeting: 3,
    not_adopted: 4,
    center: 5,
    not_done: 6,
    followup: 7,
  };
  const current = reached[s];
  const failed = s === 'refused' || s === 'not_adopted' || s === 'not_done' || s === 'cancelled';
  const dates: (string | null | undefined)[] = [
    r.created_at,
    r.accepted_at ?? r.refused_at,
    r.appointment_starts_at,
    r.concluded_at,
    r.referral_viewed_at,
    r.outcome_at,
    null,
  ];
  return STEP_LABELS.map((label, i) => {
    const n = i + 1;
    let state: StepState;
    if (n === 3 && !doctor) state = 'skipped';
    else if (n < current) state = 'done';
    else if (n === current) state = failed ? 'failed' : 'current';
    else state = 'todo';
    return { n, label, state, date: state === 'done' || state === 'failed' ? dates[i] ?? null : null };
  });
}

const fail = (m: string): never => {
  throw new BadRequestException(m);
};

/** Liste de lignes (avantages, inconvénients, critères) saisie dans l'admin */
export function cleanList(v: unknown, label: string): string[] {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : [];
  const list = raw.map((x) => String(x ?? '').trim()).filter(Boolean);
  if (list.length > 20) fail(`${label} : 20 lignes au maximum.`);
  list.forEach((x) => x.length > 300 && fail(`${label} : chaque ligne fait au plus 300 caractères.`));
  return list;
}

export function parseList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v !== 'string' || !v) return [];
  try {
    const x = JSON.parse(v);
    return Array.isArray(x) ? x.map(String) : [];
  } catch {
    return [];
  }
}

/** Identifiant lisible d'une fiche : minuscules, sans accents, mots séparés par « - » */
export function slugify(name: string) {
  return String(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

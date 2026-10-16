import { BadRequestException } from '@nestjs/common';
import { ageOn, beninToday, MAX_AGE, MIN_AGE } from '../common/field-rules';

// Ciblage d'une campagne (16/10/2026) : sexe (les deux, féminin seulement, masculin seulement)
// et tranche d'âge. Une personne hors cible ne peut ni demander ni retirer un kit.

export const TARGET_SEXES = ['all', 'female', 'male'] as const;
export type TargetSex = (typeof TARGET_SEXES)[number];
export type Target = { target_sex: TargetSex; target_age_min: number | null; target_age_max: number | null };

const ageValue = (v: unknown, label: string): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < MIN_AGE || n > MAX_AGE) {
    throw new BadRequestException(`${label} doit être un nombre entier entre ${MIN_AGE} et ${MAX_AGE}.`);
  }
  return n;
};

// Lecture du formulaire de campagne (admin). Champs absents = pas de ciblage (comme avant).
export function cleanTarget(body: any): Target {
  const sex = body?.target_sex === undefined || body?.target_sex === null || body?.target_sex === '' ? 'all' : String(body.target_sex);
  if (!(TARGET_SEXES as readonly string[]).includes(sex)) throw new BadRequestException('Public ciblé non valide.');
  const min = ageValue(body?.target_age_min, "L'âge minimum");
  const max = ageValue(body?.target_age_max, "L'âge maximum");
  if (min !== null && max !== null && min > max) throw new BadRequestException("L'âge minimum ne peut pas dépasser l'âge maximum.");
  return { target_sex: sex as TargetSex, target_age_min: min, target_age_max: max };
}

export function readTarget(row: any): Target {
  const sex = (TARGET_SEXES as readonly string[]).includes(row?.target_sex) ? row.target_sex : 'all';
  const n = (v: any) => (v === null || v === undefined || v === '' ? null : Number(v));
  return { target_sex: sex, target_age_min: n(row?.target_age_min), target_age_max: n(row?.target_age_max) };
}

const SEX_AUDIENCE: Record<TargetSex, string> = {
  all: 'Tout public',
  female: 'Femmes et filles',
  male: 'Hommes et garçons',
};

// Libellé affiché (site, admin) : « Femmes et filles, 15 à 24 ans »
export function targetLabel(t: Target): string {
  const { target_age_min: a, target_age_max: b } = t;
  const age = a !== null && b !== null ? `${a} à ${b} ans` : a !== null ? `${a} ans et plus` : b !== null ? `${b} ans au plus` : '';
  return [SEX_AUDIENCE[t.target_sex], age].filter(Boolean).join(', ');
}

export const PROFILE_INCOMPLETE = 'profile_incomplete';

// Raison du refus (texte lisible), ou null si la personne fait partie du public ciblé
export function targetMismatch(
  t: Target,
  person: { birth_date?: string | null; sex?: string | null },
  day: string = beninToday(),
): { reason: 'profile_incomplete' | 'not_targeted'; message: string } | null {
  if (!person.birth_date || !person.sex) {
    return { reason: PROFILE_INCOMPLETE, message: 'Indiquez votre date de naissance et votre sexe pour demander un kit.' };
  }
  if (t.target_sex !== 'all' && person.sex !== t.target_sex) {
    return {
      reason: 'not_targeted',
      message: t.target_sex === 'female'
        ? 'Cette campagne est réservée aux femmes et aux filles.'
        : 'Cette campagne est réservée aux hommes et aux garçons.',
    };
  }
  const age = ageOn(person.birth_date, day);
  const { target_age_min: a, target_age_max: b } = t;
  if ((a !== null && age < a) || (b !== null && age > b)) {
    const range = a !== null && b !== null ? `de ${a} à ${b} ans` : a !== null ? `de ${a} ans et plus` : `de ${b} ans au plus`;
    return { reason: 'not_targeted', message: `Cette campagne est réservée aux personnes ${range}.` };
  }
  return null;
}

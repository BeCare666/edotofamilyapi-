import { BadRequestException } from '@nestjs/common';

// Règles de saisie communes (16/10/2026). Les mêmes règles sont appliquées dans le navigateur
// (site : lib/fieldRules.js, admin : utils/field-rules.ts) ; l'API reste la référence, car un
// contrôle du navigateur seul se contourne. Chaque fonction renvoie la valeur nettoyée ou lève
// une erreur 400 au message lisible.

const fail = (message: string): never => {
  throw new BadRequestException(message);
};

const str = (v: unknown) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));

// Nom de personne ou d'organisation : lettres (accents compris), espaces, apostrophe, trait d'union, point
const NAME_RE = /^[\p{L}][\p{L}\p{M}' .\-]*$/u;
export function cleanName(v: unknown, label = 'Le nom'): string {
  const s = str(v).replace(/\s+/g, ' ').trim();
  if (!s) fail(`${label} est obligatoire.`);
  if (s.length < 2) fail(`${label} doit contenir au moins 2 caractères.`);
  if (s.length > 100) fail(`${label} ne doit pas dépasser 100 caractères.`);
  if (!NAME_RE.test(s)) fail(`${label} ne doit contenir que des lettres, espaces, apostrophes ou traits d'union.`);
  return s;
}

// Nom d'organisation (sponsor, établissement) : chiffres autorisés en plus
const ORG_RE = /^[\p{L}\p{N}][\p{L}\p{M}\p{N}' .,&()\-]*$/u;
export function cleanOrgName(v: unknown, label = 'Le nom'): string {
  const s = str(v).replace(/\s+/g, ' ').trim();
  if (!s) fail(`${label} est obligatoire.`);
  if (s.length < 2) fail(`${label} doit contenir au moins 2 caractères.`);
  if (s.length > 150) fail(`${label} ne doit pas dépasser 150 caractères.`);
  if (!ORG_RE.test(s)) fail(`${label} contient des caractères non autorisés.`);
  return s;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function cleanEmail(v: unknown): string {
  const s = str(v).trim().toLowerCase();
  if (!s) fail("L'adresse e-mail est obligatoire.");
  if (s.length > 190 || !EMAIL_RE.test(s)) fail("L'adresse e-mail n'est pas valide.");
  return s;
}

// Téléphone : chiffres uniquement (un « + » permis au début), 8 à 15 chiffres
export function cleanPhone(v: unknown, { required = true } = {}): string | null {
  const raw = str(v).replace(/[\s.]/g, '');
  if (!raw) {
    if (required) fail('Le numéro de téléphone est obligatoire.');
    return null;
  }
  if (!/^\+?\d+$/.test(raw)) fail('Le numéro de téléphone ne doit contenir que des chiffres.');
  const digits = raw.replace('+', '');
  if (digits.length < 8 || digits.length > 15) fail('Le numéro de téléphone doit contenir entre 8 et 15 chiffres.');
  return raw;
}

// Mot de passe : 8 à 72 caractères, au moins une minuscule, une majuscule et un chiffre
export const PASSWORD_RULES = [
  { test: (p: string) => p.length >= 8, label: '8 caractères minimum' },
  { test: (p: string) => /[a-z]/.test(p), label: 'une lettre minuscule' },
  { test: (p: string) => /[A-Z]/.test(p), label: 'une lettre majuscule' },
  { test: (p: string) => /\d/.test(p), label: 'un chiffre' },
];
export function checkPassword(v: unknown): string {
  const p = str(v);
  if (!p) fail('Le mot de passe est obligatoire.');
  // bcrypt ignore tout ce qui dépasse 72 octets
  if (Buffer.byteLength(p, 'utf8') > 72) fail('Le mot de passe ne doit pas dépasser 72 caractères.');
  if (/\s/.test(p)) fail("Le mot de passe ne doit pas contenir d'espace.");
  const missing = PASSWORD_RULES.filter((r) => !r.test(p)).map((r) => r.label);
  if (missing.length) fail(`Le mot de passe doit contenir : ${missing.join(', ')}.`);
  return p;
}

// Sexe : féminin (femme ou fille) ou masculin (homme ou garçon)
export const SEXES = ['female', 'male'] as const;
export type Sex = (typeof SEXES)[number];
export function cleanSex(v: unknown): Sex {
  const s = str(v).trim();
  if (!s) fail('Le sexe est obligatoire.');
  if (!(SEXES as readonly string[]).includes(s)) fail('Sexe non valide.');
  return s as Sex;
}

// Date du jour au Bénin (UTC+1), au format AAAA-MM-JJ
export function beninToday(now = new Date()): string {
  return new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Âge en années révolues à une date donnée (AAAA-MM-JJ)
export function ageOn(birthDate: string, day: string = beninToday()): number {
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [y, m, d] = day.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

export const MIN_AGE = 10;
export const MAX_AGE = 100;
// Date de naissance : vraie date, ni future, âge entre 10 et 100 ans
export function cleanBirthDate(v: unknown): string {
  const s = str(v).trim();
  if (!s) fail('La date de naissance est obligatoire.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail('Date de naissance non valide.');
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) fail('Date de naissance non valide.');
  if (s > beninToday()) fail('La date de naissance ne peut pas être dans le futur.');
  const age = ageOn(s);
  if (age < MIN_AGE) fail(`Il faut avoir au moins ${MIN_AGE} ans.`);
  if (age > MAX_AGE) fail('Date de naissance non valide.');
  return s;
}

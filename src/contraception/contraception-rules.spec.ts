import { cleanList, computeSteps, parseList, slugify } from './contraception-rules';
import { CONTRACEPTION_DEFAULTS } from './contraception-defaults';

const states = (r: any) => computeSteps(r).map((s) => s.state);

describe('Contraception : les 7 étapes', () => {
  it('demande envoyée : étape 1 faite, étape 2 en cours', () => {
    expect(states({ status: 'pending', requires_doctor: 1 })).toEqual(['done', 'current', 'todo', 'todo', 'todo', 'todo', 'todo']);
  });

  it('avec médecin, acceptée : rencontre à faire (étape 3 en cours)', () => {
    expect(states({ status: 'accepted', requires_doctor: 1 })).toEqual(['done', 'done', 'current', 'todo', 'todo', 'todo', 'todo']);
  });

  it('sans médecin : la rencontre (étape 3) est sautée, passage au centre en cours', () => {
    expect(states({ status: 'center', requires_doctor: 0 })).toEqual(['done', 'done', 'skipped', 'done', 'current', 'todo', 'todo']);
  });

  it('refusée : échec à l’étape 2', () => {
    expect(states({ status: 'refused', requires_doctor: 1 })[1]).toBe('failed');
  });

  it('pas d’adoption après la rencontre : échec à l’étape 4', () => {
    expect(states({ status: 'not_adopted', requires_doctor: 1 })).toEqual(['done', 'done', 'done', 'failed', 'todo', 'todo', 'todo']);
  });

  it('adoption faite : les 6 premières étapes sont faites, suivi en cours', () => {
    expect(states({ status: 'followup', requires_doctor: 1 })).toEqual(['done', 'done', 'done', 'done', 'done', 'done', 'current']);
  });

  it('adoption non faite au centre : échec à l’étape 6', () => {
    expect(states({ status: 'not_done', requires_doctor: 0 })).toEqual(['done', 'done', 'skipped', 'done', 'done', 'failed', 'todo']);
  });
});

describe('Contraception : saisies et fiches par défaut', () => {
  it('nettoie les listes saisies ligne par ligne', () => {
    expect(cleanList(' Un \n\n Deux ', 'Liste')).toEqual(['Un', 'Deux']);
    expect(parseList('["a","b"]')).toEqual(['a', 'b']);
    expect(parseList('pas du json')).toEqual([]);
  });

  it('crée un identifiant sans accents', () => {
    expect(slugify('Pilule d’urgence (lévonorgestrel)')).toBe('pilule-d-urgence-levonorgestrel');
  });

  it('fiches par défaut complètes, identifiants uniques, sans tiret long', () => {
    const slugs = new Set(CONTRACEPTION_DEFAULTS.map((m) => m.slug));
    expect(slugs.size).toBe(CONTRACEPTION_DEFAULTS.length);
    for (const m of CONTRACEPTION_DEFAULTS) {
      expect(m.advantages.length).toBeGreaterThan(0);
      expect(m.drawbacks.length).toBeGreaterThan(0);
      expect(m.criteria.length).toBeGreaterThan(0);
      expect(JSON.stringify(m)).not.toMatch(/[—–]/);
    }
    // Les deux familles existent : avec et sans médecin
    expect(CONTRACEPTION_DEFAULTS.some((m) => m.requires_doctor === 1)).toBe(true);
    expect(CONTRACEPTION_DEFAULTS.some((m) => m.requires_doctor === 0)).toBe(true);
  });
});

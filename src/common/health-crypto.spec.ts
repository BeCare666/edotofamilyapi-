import { randomBytes } from 'crypto';
import { checkHealthKey, healthEncryptionEnabled, isSealed, openFields, openHealth, sealHealth } from './health-crypto';
import { ContraceptionService } from '../contraception/contraception.service';
import { TeleconsultationService } from '../teleconsultation/teleconsultation.service';
import { AiChatRetentionCron } from '../ai/chat/ai-chat-retention.cron';

// Audit sécurité 2.5 (29/10/2026) : données de santé chiffrées en base, journal des accès, conservation du chat IA
const ENV = ['HEALTH_DATA_KEY', 'HEALTH_DATA_KEY_ID', 'HEALTH_DATA_OLD_KEYS'];
const saved: Record<string, string | undefined> = {};
const k1 = randomBytes(32).toString('base64');
const k2 = randomBytes(32).toString('hex');

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  for (const k of ENV) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('Chiffrement AES-256-GCM des données de santé', () => {
  it('sans clé : rien n’est chiffré, la lecture rend le texte', () => {
    expect(healthEncryptionEnabled()).toBe(false);
    expect(sealHealth('Allergie à la pénicilline')).toBe('Allergie à la pénicilline');
    expect(openHealth('Allergie à la pénicilline')).toBe('Allergie à la pénicilline');
  });

  it('avec clé : valeur chiffrée, différente à chaque écriture, relue à l’identique', () => {
    process.env.HEALTH_DATA_KEY = k1;
    const a = sealHealth('Douleurs pelviennes, 17 ans') as string;
    const b = sealHealth('Douleurs pelviennes, 17 ans') as string;
    expect(isSealed(a)).toBe(true);
    expect(a.startsWith('hd1.k1.')).toBe(true);
    expect(a).not.toContain('Douleurs');
    expect(a).not.toBe(b);
    expect(openHealth(a)).toBe('Douleurs pelviennes, 17 ans');
  });

  it('null, vide et valeur déjà chiffrée : inchangés', () => {
    process.env.HEALTH_DATA_KEY = k1;
    const once = sealHealth('x') as string;
    expect(sealHealth(null)).toBeNull();
    expect(sealHealth(undefined)).toBeUndefined();
    expect(sealHealth('')).toBe('');
    expect(sealHealth(once)).toBe(once);
    expect(openHealth(null)).toBeNull();
  });

  it('anciennes valeurs en clair toujours lisibles après l’activation', () => {
    process.env.HEALTH_DATA_KEY = k1;
    expect(openHealth('note saisie avant le 29/10')).toBe('note saisie avant le 29/10');
  });

  it('rotation : nouvelle clé k2, les valeurs k1 restent lisibles via HEALTH_DATA_OLD_KEYS', () => {
    process.env.HEALTH_DATA_KEY = k1;
    const old = sealHealth('ancienne') as string;
    process.env.HEALTH_DATA_KEY = k2;
    process.env.HEALTH_DATA_KEY_ID = 'k2';
    process.env.HEALTH_DATA_OLD_KEYS = `k1:${k1}`;
    const fresh = sealHealth('nouvelle') as string;
    expect(fresh.startsWith('hd1.k2.')).toBe(true);
    expect(openHealth(old)).toBe('ancienne');
    expect(openHealth(fresh)).toBe('nouvelle');
  });

  it('clé absente ou incorrecte, valeur altérée : erreur (jamais un champ vide)', () => {
    process.env.HEALTH_DATA_KEY = k1;
    const v = sealHealth('secret') as string;
    delete process.env.HEALTH_DATA_KEY;
    expect(() => openHealth(v)).toThrow(/clé « k1 »/);
    process.env.HEALTH_DATA_KEY = k2;
    expect(() => openHealth(v)).toThrow(/illisible/);
    process.env.HEALTH_DATA_KEY = k1;
    const parts = v.split('.');
    parts[4] = Buffer.from('autre').toString('base64url');
    expect(() => openHealth(parts.join('.'))).toThrow(/illisible/);
  });

  it('clé mal formée : démarrage refusé', () => {
    process.env.HEALTH_DATA_KEY = 'trop-courte';
    expect(() => checkHealthKey()).toThrow(/32 octets/);
    process.env.HEALTH_DATA_KEY = k1;
    process.env.HEALTH_DATA_OLD_KEYS = 'sans-separateur';
    expect(() => checkHealthKey()).toThrow(/HEALTH_DATA_OLD_KEYS/);
  });

  it('openFields : seulement les champs indiqués, ligne absente rendue telle quelle', () => {
    process.env.HEALTH_DATA_KEY = k1;
    const row = { id: 3, youth_note: sealHealth('note'), method_name: 'Implant' };
    expect(openFields(row, ['youth_note'])).toEqual({ id: 3, youth_note: 'note', method_name: 'Implant' });
    expect(openFields(null, ['youth_note'])).toBeNull();
  });
});

describe('Services : écriture chiffrée, lecture en clair, accès journalisés', () => {
  const pool = (answer: (sql: string, params: any[]) => any) => {
    const query = jest.fn(async (sql: string, params: any[] = []) => answer(sql, params));
    return { db: { getPool: () => ({ query }) } as any, query };
  };

  it('suivi de contraception : contenu chiffré en base, relu en clair', async () => {
    process.env.HEALTH_DATA_KEY = k1;
    const stored: any[] = [];
    const { db, query } = pool((sql, params) => {
      if (sql.startsWith('SELECT id, status FROM contraception_requests')) return [[{ id: 4, status: 'followup' }]];
      if (sql.startsWith('INSERT INTO contraception_followups')) stored.push(params[2]);
      return [{ affectedRows: 1 }];
    });
    const svc = new ContraceptionService(db, {} as any);
    await svc.addYouthFollowup(9, 4, { content: 'Saignements légers depuis la pose' });
    expect(isSealed(stored[0])).toBe(true);
    expect(query).toHaveBeenCalled();
    expect((svc as any).presentFollowup({ id: 1, author_role: 'youth', content: stored[0] }).content).toBe('Saignements légers depuis la pose');
  });

  it('prise en charge par le centre : note chiffrée dans tc_referrals et contraception_requests', async () => {
    process.env.HEALTH_DATA_KEY = k1;
    const notes: any[] = [];
    const { db } = pool((sql, params) => {
      if (sql.startsWith('SELECT * FROM tc_centers')) return [[{ id: 2, is_active: 1 }]];
      if (sql.startsWith('SELECT contraception_request_id')) return [[{ contraception_request_id: 7 }]];
      if (sql.startsWith('UPDATE tc_referrals')) notes.push(params[1]);
      if (sql.startsWith('UPDATE contraception_requests')) notes.push(params[1]);
      return [{ affectedRows: 1 }];
    });
    await new TeleconsultationService(db).centerComplete(11, 5, { note: 'Implant posé', outcome: 'done' });
    expect(notes).toHaveLength(2);
    expect(notes.every(isSealed)).toBe(true);
    expect(notes.map((n) => openHealth(n))).toEqual(['Implant posé', 'Implant posé']);
  });

  it('dossier ouvert par un centre : compte rendu déchiffré et accès journalisé (compte, patient, IP)', async () => {
    process.env.HEALTH_DATA_KEY = k1;
    const logs: any[] = [];
    const { db } = pool((sql, params) => {
      if (sql.startsWith('SELECT * FROM tc_centers')) return [[{ id: 2, is_active: 1, name: 'Centre' }]];
      if (sql.startsWith('SELECT *, (expires_at')) {
        return [[{ id: 5, center_id: 2, status: 'viewed', viewed_at: '2026-10-29', is_expired: 0, report_id: 8, appointment_id: null, patient_user_id: 30 }]];
      }
      if (sql.startsWith('INSERT INTO health_access_log')) logs.push(params);
      if (sql.startsWith('SELECT * FROM tc_reports')) return [[{ id: 8, request_type: 'other', urgency: 'routine', allergies: sealHealth('Latex'), plan: 'clair avant 29/10' }]];
      if (sql.includes('FROM users u')) return [[{ name: 'A' }]];
      if (sql.startsWith('SELECT status, outcome')) return [[{ status: 'viewed', completed_note: sealHealth('RAS') }]];
      return [[]];
    });
    const out: any = await new TeleconsultationService(db).centerDossier(11, { code: 'ABCD2345' }, '203.0.113.9');
    expect(out.report.allergies).toBe('Latex');
    expect(out.report.plan).toBe('clair avant 29/10');
    expect(out.referral.completed_note).toBe('RAS');
    expect(logs).toEqual([[11, 'health_center', 30, 'tc_referral', 5, '203.0.113.9']]);
  });

  it('journal du chat IA : suppression au-delà de 90 jours, par paquets', async () => {
    const { db, query } = pool(() => [{ affectedRows: 3 }]);
    expect(await new AiChatRetentionCron(db).purge()).toBe(3);
    expect(query.mock.calls[0][0]).toContain('DELETE FROM ai_chat_logs WHERE created_at < DATE_SUB');
    expect(query.mock.calls[0][1]).toEqual([90]);
  });
});

import { fetchFeexPayTransaction, verifyFeexPayForOrder } from './feexpay-verify';

// Audit sécurité 1.1 (C3, 29/10/2026) : chaque paiement FeexPay est vérifié côté serveur (API v2)
describe('Vérification FeexPay côté serveur', () => {
  const ENV = { ...process.env };
  beforeAll(() => {
    process.env.FEEXPAY_API_KEY = 'fp_cle_de_test';
    delete process.env.FEEXPAY_API_BASE;
  });
  afterAll(() => {
    process.env = ENV;
  });
  const REF = '63ecaff1-7572-413d-93bb-8cba92bb8c2c';
  const answer = (body: any, status = 200) => jest.fn(async () => ({ ok: status < 400, status, json: async () => body }));
  const notUsed = async () => false;

  it('appelle la route v2 de statut avec la clé en Bearer', async () => {
    const f = answer({ reference: REF, amount: 5000, status: 'SUCCESSFUL' });
    await fetchFeexPayTransaction(REF, f as any, 0);
    expect((f.mock.calls[0] as any)[0]).toBe(`https://api-v2.feexpay.me/api/transactions/public/single/status/${REF}`);
    expect((f.mock.calls[0] as any)[1].headers.Authorization).toBe('Bearer fp_cle_de_test');
  });

  it('paiement confirmé, montant suffisant, jamais utilisé : accepté', async () => {
    const tx = await verifyFeexPayForOrder(REF, { total: 5000 }, notUsed, answer({ reference: REF, amount: 5000, status: 'SUCCESSFUL' }) as any, 0);
    expect(tx.status).toBe('SUCCESSFUL');
  });

  it.each([
    ['transaction échouée', { reference: REF, amount: 5000, status: 'FAILED' }, 'non confirmé'],
    ['montant inférieur au total', { reference: REF, amount: 100, status: 'SUCCESSFUL' }, 'ne couvre pas'],
    ['référence différente', { reference: 'autre-reference-123', amount: 5000, status: 'SUCCESSFUL' }, 'incohérente'],
    ['toujours en attente après 3 essais', { reference: REF, amount: 5000, status: 'PENDING' }, 'en cours de confirmation'],
  ])('%s : refusé (402)', async (_n, body, msg) => {
    await expect(verifyFeexPayForOrder(REF, { total: 5000 }, notUsed, answer(body) as any, 0)).rejects.toMatchObject({ status: 402, message: expect.stringContaining(msg) });
  });

  it('transaction inventée (404 chez FeexPay) ou référence mal formée : refusée (402)', async () => {
    await expect(verifyFeexPayForOrder(REF, { total: 5000 }, notUsed, answer({}, 404) as any, 0)).rejects.toMatchObject({ status: 402 });
    await expect(verifyFeexPayForOrder("x' OR 1=1", { total: 5000 }, notUsed, answer({}) as any, 0)).rejects.toMatchObject({ status: 402 });
  });

  it('transaction déjà utilisée pour une autre commande : refusée (409)', async () => {
    await expect(verifyFeexPayForOrder(REF, { total: 5000 }, async () => true, answer({ reference: REF, amount: 5000, status: 'SUCCESSFUL' }) as any, 0)).rejects.toMatchObject({ status: 409 });
  });

  it('total de commande absent : jamais validé', async () => {
    await expect(verifyFeexPayForOrder(REF, {}, notUsed, answer({ reference: REF, amount: 5000, status: 'SUCCESSFUL' }) as any, 0)).rejects.toMatchObject({ status: 402 });
  });

  it('FeexPay injoignable ou clé absente : 503, jamais validé', async () => {
    const down = jest.fn(async () => { throw new Error('timeout'); });
    await expect(verifyFeexPayForOrder(REF, { total: 5000 }, notUsed, down as any, 0)).rejects.toMatchObject({ status: 503 });
    delete process.env.FEEXPAY_API_KEY;
    await expect(verifyFeexPayForOrder(REF, { total: 5000 }, notUsed, answer({}) as any, 0)).rejects.toMatchObject({ status: 503 });
    process.env.FEEXPAY_API_KEY = 'fp_cle_de_test';
  });

  it('en attente puis confirmé au 2e essai : accepté', async () => {
    const seq = [{ reference: REF, amount: 5000, status: 'PENDING' }, { reference: REF, amount: 5000, status: 'SUCCESSFUL' }];
    const f = jest.fn(async () => ({ ok: true, status: 200, json: async () => seq.shift() }));
    await expect(verifyFeexPayForOrder(REF, { total: 5000 }, notUsed, f as any, 0)).resolves.toMatchObject({ status: 'SUCCESSFUL' });
    expect(f).toHaveBeenCalledTimes(2);
  });
});

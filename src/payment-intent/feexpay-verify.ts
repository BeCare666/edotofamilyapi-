import { ConflictException, HttpException, HttpStatus, ServiceUnavailableException } from '@nestjs/common';

/**
 * Vérification serveur d'un paiement FeexPay (audit sécurité 1.1, C3, 29/10/2026).
 * Source : documentation officielle docs.feexpay.me (API v2) et SDK https://api-v2.feexpay.me/feexpay-javascript-sdk/index.js.
 *   GET https://api-v2.feexpay.me/api/transactions/public/single/status/{reference}
 *   Authorization: Bearer <clé API FeexPay>  (FEEXPAY_API_KEY sur Render, même clé que le site)
 *   Réponse : { reference, amount, status: SUCCESSFUL | FAILED | PENDING, date, … }
 * La réponse ne contient pas le numéro de commande : le paiement est accepté si FeexPay le confirme,
 * si le montant couvre le total de la commande, et si cette transaction n'a encore payé aucune commande
 * (colonne payment_intents.feexpay_reference UNIQUE, migration 021).
 */
export const FEEXPAY_API_BASE = 'https://api-v2.feexpay.me';
const REFERENCE_RE = /^[A-Za-z0-9-]{8,64}$/;

export type FeexPayTransaction = { reference: string; amount: number; status: string };
export type FeexFetch = (url: string, init: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function paymentRefused(message: string): HttpException {
  return new HttpException({ statusCode: 402, error: 'PAYMENT_NOT_CONFIRMED', message }, HttpStatus.PAYMENT_REQUIRED);
}

/** Statut de la transaction chez FeexPay ; « PENDING » : jusqu'à 3 essais espacés de 2 s */
export async function fetchFeexPayTransaction(reference: unknown, doFetch: FeexFetch = fetch as any, waitMs = 2000): Promise<FeexPayTransaction> {
  const ref = String(reference ?? '').trim();
  if (!REFERENCE_RE.test(ref)) throw paymentRefused('Référence de paiement FeexPay invalide.');
  const key = process.env.FEEXPAY_API_KEY;
  if (!key) throw new ServiceUnavailableException('Vérification des paiements indisponible : contactez l’équipe E.doto family.');
  const base = (process.env.FEEXPAY_API_BASE || FEEXPAY_API_BASE).replace(/\/+$/, '');

  let last: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Awaited<ReturnType<FeexFetch>>;
    try {
      res = await doFetch(`${base}/api/transactions/public/single/status/${encodeURIComponent(ref)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new ServiceUnavailableException('FeexPay ne répond pas : le paiement sera vérifié plus tard. Ne repayez pas.');
    }
    if (res.status === 404) throw paymentRefused('Transaction introuvable chez FeexPay.');
    if (!res.ok) throw new ServiceUnavailableException('FeexPay ne répond pas : le paiement sera vérifié plus tard. Ne repayez pas.');
    last = await res.json().catch(() => null);
    const status = String(last?.status || '').toUpperCase();
    if (status !== 'PENDING') break;
    if (attempt < 2) await sleep(waitMs);
  }
  return { reference: String(last?.reference || ''), amount: Number(last?.amount), status: String(last?.status || '').toUpperCase() };
}

/** Paiement accepté pour cette commande, sinon exception (402, 409, 503) */
export async function verifyFeexPayForOrder(
  reference: unknown,
  order: { total?: any; [k: string]: any },
  alreadyUsed: (ref: string) => Promise<boolean>,
  doFetch?: FeexFetch,
  waitMs?: number,
): Promise<FeexPayTransaction> {
  const tx = await fetchFeexPayTransaction(reference, doFetch, waitMs);
  if (tx.status === 'PENDING') throw paymentRefused('Paiement en cours de confirmation chez FeexPay : réessayez dans un instant.');
  if (tx.status !== 'SUCCESSFUL' && tx.status !== 'SUCCESS') throw paymentRefused('Paiement non confirmé par FeexPay.');
  if (tx.reference && tx.reference !== String(reference).trim()) throw paymentRefused('Référence de paiement incohérente.');
  const total = Number(order?.total);
  if (!Number.isFinite(total) || total <= 0) throw paymentRefused('Total de la commande inconnu : paiement non validé.');
  if (!Number.isFinite(tx.amount) || tx.amount < total) throw paymentRefused('Le montant payé ne couvre pas le total de la commande.');
  if (await alreadyUsed(String(reference).trim())) throw new ConflictException('Ce paiement a déjà servi pour une autre commande.');
  return tx;
}

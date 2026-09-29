import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from './ai-chat.constants';

// Limiteur en mémoire par IP (fenêtre glissante). Suffisant pour une instance unique ;
// à remplacer par un stockage partagé si l'API tourne sur plusieurs instances.
const hits = new Map<string, number[]>();

export function consumeRateLimit(key: string, now = Date.now()): boolean {
  const recent = (hits.get(key) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 10000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < RATE_LIMIT_WINDOW_MS)) hits.delete(k);
  }
  return true;
}

export function clientIp(req: any): string {
  const fwd = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.ip || req.socket?.remoteAddress || 'unknown';
}

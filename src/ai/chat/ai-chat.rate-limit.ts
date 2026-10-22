import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from './ai-chat.constants';
import { realClientIp } from '../../common/client-ip';

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

// Adresse fiable (CF-Connecting-IP), et non la première valeur de X-Forwarded-For choisie par le client
export function clientIp(req: any): string {
  return realClientIp(req) || 'unknown';
}

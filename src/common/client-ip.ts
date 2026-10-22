/**
 * Adresse réelle du client (audit sécurité 1.2, 22/10/2026).
 * En production l'API est derrière Cloudflare puis le proxy de Render (en-têtes Server: cloudflare, x-render-origin-server).
 * - CF-Connecting-IP : posé par Cloudflare avec l'adresse qui s'est connectée à lui.
 * - X-Forwarded-For : Cloudflare et Render AJOUTENT leur adresse à ce que le client a envoyé,
 *   la première valeur est donc choisie par le client : ne jamais s'en servir pour limiter.
 * - True-Client-IP : seulement chez Cloudflare Enterprise, sinon transmis tel quel : ignoré.
 * Hors Cloudflare (poste local, tests) : adresse de la connexion.
 */
export function realClientIp(req: any): string | null {
  const cf = req?.headers?.['cf-connecting-ip'];
  const raw = String(Array.isArray(cf) ? cf[0] : cf || '').trim() || req?.ip || req?.socket?.remoteAddress || '';
  const clean = String(raw).replace(/^::ffff:/, '').trim();
  return clean && clean.length <= 64 ? clean : null;
}

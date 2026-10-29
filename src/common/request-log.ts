/**
 * Journal des requêtes (audit sécurité 2.7, 29/10/2026) : une ligne par requête terminée,
 * méthode, adresse masquée, statut, durée. Jamais d'en-tête, de corps ni de jeton.
 */

// Segments d'adresse qui sont des secrets : la valeur qui suit est remplacée par ***
const SECRET_SEGMENTS = [
  /(\/courier-links\/)[^/?#]+/gi,
  /(\/sponsor-invitations\/)(?!accept\b)[^/?#]+/gi,
  /(\/teleconsultation\/invitations\/)(?!accept\b)[^/?#]+/gi,
  /(\/teleconsultation\/qr(?:-info)?\/)[^/?#]+/gi,
  /(\/dossier\/(?:token|code)\/)[^/?#]+/gi,
  /(\/verify-email\/)[^/?#]+/gi,
];

// Paramètres d'adresse dont la valeur n'est jamais écrite
const SECRET_PARAMS = /^(token|code|otp|password|secret|key|signature|hash|email|phone)$/i;

export function maskUrl(url: string): string {
  const raw = String(url || '');
  const q = raw.indexOf('?');
  let path = q >= 0 ? raw.slice(0, q) : raw;
  for (const re of SECRET_SEGMENTS) path = path.replace(re, '$1***');
  if (q < 0) return path;
  const query = raw
    .slice(q + 1)
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf('=');
      const name = i >= 0 ? pair.slice(0, i) : pair;
      let decoded = name;
      try {
        decoded = decodeURIComponent(name);
      } catch {
        /* nom mal encodé : gardé tel quel */
      }
      return i >= 0 && SECRET_PARAMS.test(decoded) ? `${name}=***` : pair;
    })
    .join('&');
  return query ? `${path}?${query}` : path;
}

export function requestLogger() {
  return (req: any, res: any, next: () => void) => {
    const start = Date.now();
    res.on('finish', () => {
      console.log(`${req.method} ${maskUrl(req.originalUrl || req.url)} ${res.statusCode} ${Date.now() - start}ms`);
    });
    next();
  };
}

/**
 * Erreur réduite à son code et à son message pour les journaux (audit 2.7) : jamais l'objet entier,
 * qui contient la requête SQL avec ses valeurs (mysql2) ou la réponse complète d'un service d'e-mail.
 */
export function safeError(err: unknown): string {
  const e: any = err;
  const code = e?.code ? `${e.code} ` : '';
  const status = e?.response?.status ?? e?.statusCode ?? e?.status;
  const message = String(e?.message ?? e ?? 'erreur inconnue')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '***@***')
    .slice(0, 300);
  return `${code}${typeof status === 'number' ? `(HTTP ${status}) ` : ''}${message}`;
}

/** Adresse e-mail masquée pour les journaux : a***@gmail.com */
export function maskEmail(email: unknown): string {
  const [user, domain] = String(email ?? '').split('@');
  return domain ? `${user.slice(0, 1)}***@${domain}` : '***';
}

/** Numéro masqué pour les journaux : ***42 */
export function maskPhone(phone: unknown): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? `***${digits.slice(-2)}` : '***';
}

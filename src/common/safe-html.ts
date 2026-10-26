import sanitizeHtml from 'sanitize-html';

/**
 * HTML enregistré nettoyé (audit sécurité 1.6, H1, 26/10/2026) : descriptions de produits, FAQ, conditions générales,
 * boutiques. Même liste que le site et l'admin. h2 et h3 ajoutés au plan : les descriptions réelles les utilisent.
 * Tout le reste (script, style, img, iframe, attributs, on*, liens non https) est retiré, le texte est gardé.
 */
export const SAFE_HTML_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'h2', 'h3', 'a'],
  allowedAttributes: { a: ['href'] },
  allowedSchemes: ['https'],
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  transformTags: { b: 'strong', i: 'em' },
};

// Les valeurs non textuelles (null, undefined) sont rendues telles quelles : « ne pas modifier » reste possible.
export function safeHtml<T>(value: T): T | string {
  return typeof value === 'string' ? sanitizeHtml(value, SAFE_HTML_OPTIONS) : value;
}

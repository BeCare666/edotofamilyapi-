import { v2 as cloudinary } from 'cloudinary';

/**
 * Factures (audit sécurité 2.8, 29/10/2026) : PDF déposés sur Cloudinary en accès restreint (« authenticated »),
 * jamais en lien public. Avant, l'adresse publique se devinait à partir du numéro de commande.
 * L'API ne donne qu'un lien de téléchargement signé, valable INVOICE_LINK_SECONDS, après contrôle du rôle.
 */
export const INVOICE_STORAGE_TYPE = 'authenticated';
export const INVOICE_LINK_SECONDS = 5 * 60;

export function configureCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

/** Adresse Cloudinary d'un fichier brut → mode de stockage et identifiant (null si ce n'en est pas une) */
export function parseRawUrl(url: string | null | undefined): { type: string; publicId: string } | null {
  const m = String(url || '').match(/\/raw\/(upload|authenticated|private)\/(?:s--[^/]+--\/)?(?:v\d+\/)?([^?#]+)$/);
  return m ? { type: m[1], publicId: decodeURIComponent(m[2]) } : null;
}

/** Lien de téléchargement signé, de courte durée (fichier restreint) ; ancien lien public rendu tel quel */
export function signedInvoiceUrl(url: string, now = Date.now()): { url: string; expires_at: string | null } {
  const raw = parseRawUrl(url);
  if (!raw || raw.type === 'upload') return { url, expires_at: null };
  configureCloudinary();
  const expiresAt = Math.floor(now / 1000) + INVOICE_LINK_SECONDS;
  return {
    url: cloudinary.utils.private_download_url(raw.publicId, '', {
      resource_type: 'raw',
      type: raw.type,
      expires_at: expiresAt,
      attachment: true,
    }),
    expires_at: new Date(expiresAt * 1000).toISOString(),
  };
}

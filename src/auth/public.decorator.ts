import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Route accessible sans connexion (audit sécurité 1.4, C5, 24/10/2026).
 * Le guard JWT est global : toute route sans @Public() exige un jeton valide.
 * À poser sur la MÉTHODE uniquement, jamais sur la classe, pour qu'aucune route ajoutée plus tard
 * dans un contrôleur public ne soit ouverte par défaut.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

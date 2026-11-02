import { ForbiddenException } from '@nestjs/common';
import { settingOn } from '../platform-settings/platform-settings.store';

// Inscription des vendeurs (passage d'un compte au rôle store_owner) : FERMÉE pour l'instant
// (décision du 25/09/2026). Pour la rouvrir plus tard : SELLER_SIGNUP_OPEN=true, sans changer le code.
export const SELLER_SIGNUP_CLOSED_MESSAGE = 'Inscription des vendeurs bientôt disponible.';

export function isSellerSignupOpen() {
  // Réglable par le super admin (02/11/2026, Paramètres → Avancés) ; SELLER_SIGNUP_OPEN sert de valeur par défaut
  return settingOn('signup.seller_open');
}

export function assertSellerSignupOpen() {
  if (!isSellerSignupOpen()) throw new ForbiddenException(SELLER_SIGNUP_CLOSED_MESSAGE);
}

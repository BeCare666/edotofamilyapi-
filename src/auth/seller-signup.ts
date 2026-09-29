import { ForbiddenException } from '@nestjs/common';

// Inscription des vendeurs (passage d'un compte au rôle store_owner) : FERMÉE pour l'instant
// (décision du 25/09/2026). Pour la rouvrir plus tard : SELLER_SIGNUP_OPEN=true, sans changer le code.
export const SELLER_SIGNUP_CLOSED_MESSAGE = 'Inscription des vendeurs bientôt disponible.';

export function isSellerSignupOpen() {
  return process.env.SELLER_SIGNUP_OPEN === 'true';
}

export function assertSellerSignupOpen() {
  if (!isSellerSignupOpen()) throw new ForbiddenException(SELLER_SIGNUP_CLOSED_MESSAGE);
}

// Retire les champs sensibles d'une ligne users avant de la renvoyer au client.
export function omitPassword<T extends Record<string, any>>(user: T): Omit<T, 'password'> {
  if (!user || typeof user !== 'object') return user;
  const { password, ...rest } = user;
  return rest;
}

// Valeur renvoyée à la place d'un OTP réel pour les rôles qui ne doivent pas le lire.
// Garde la compatibilité avec les écrans qui affichent seulement « Présent / Non défini ».
export const MASKED_OTP = '******';

export function maskOtp<T extends Record<string, any>>(row: T): T {
  if (!row || typeof row !== 'object' || !('otp_code' in row)) return row;
  return { ...row, otp_code: row.otp_code ? MASKED_OTP : null };
}

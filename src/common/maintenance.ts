/**
 * Mode maintenance (audit sécurité 3.7, plan de réponse à incident, 29/10/2026).
 * MAINTENANCE_MODE=on sur Render (puis redémarrage) : toutes les routes répondent 503, connexion comprise.
 * Sert à couper l'API pendant un incident sans supprimer le service. Valeur absente ou autre : API normale.
 */
export const MAINTENANCE_MESSAGE = 'E.doto family est momentanément en maintenance. Réessayez un peu plus tard.';

export function maintenanceOn(env = process.env.MAINTENANCE_MODE): boolean {
  return String(env || '').trim().toLowerCase() === 'on';
}

export function maintenanceGate() {
  return (_req: any, res: any, next: () => void) => {
    if (!maintenanceOn()) return next();
    res.setHeader('Retry-After', '600');
    res.status(503).json({ statusCode: 503, message: MAINTENANCE_MESSAGE });
  };
}

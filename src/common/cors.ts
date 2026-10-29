import { INestApplication } from '@nestjs/common';
import helmet from 'helmet';

/**
 * CORS limité aux applications E.doto family (audit sécurité 1.3, 22/10/2026).
 * Seuls les navigateurs appliquent CORS : les appels sans en-tête Origin (FeexPay, Render, curl) restent acceptés,
 * leur protection vient des guards, pas de CORS.
 */
export const PROD_ORIGINS = [
  'https://www.edotofamily.com',
  'https://edotofamily.com',
  'https://edotofamily.vercel.app',
  'https://edotofamilyadmin.vercel.app',
];
const DEV_ORIGINS = ['http://localhost:3000', 'http://localhost:3001'];

export function allowedOrigins(env = process.env.NODE_ENV): string[] {
  return env === 'production' ? PROD_ORIGINS : [...PROD_ORIGINS, ...DEV_ORIGINS];
}

export function isAllowedOrigin(origin: string | undefined, env = process.env.NODE_ENV): boolean {
  return !origin || allowedOrigins(env).includes(origin);
}

export const CORS_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
// X-Step-Up : autorisation de 5 min après le code de double authentification (actions sensibles, 3.1)
export const CORS_HEADERS = ['Authorization', 'Content-Type', 'Accept', 'X-Step-Up'];

// Appelé par main.ts. cross-origin : le site et l'admin, sur d'autres domaines, lisent les réponses et fichiers de l'API
export function applySecurity(app: INestApplication): void {
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.enableCors({
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
    methods: CORS_METHODS,
    allowedHeaders: CORS_HEADERS,
  });
}

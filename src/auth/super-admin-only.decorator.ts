import { applyDecorators, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles, SUPER_ADMIN } from './roles.decorator';

/**
 * Route réservée au super admin connecté (401 sans jeton, 403 pour les autres rôles).
 * Équivaut à @UseGuards(JwtAuthGuard, RolesGuard) + @Roles(SUPER_ADMIN).
 * Posé le 22/10/2026 sur les routes d'écriture restées publiques (audit sécurité, C5).
 */
export const SuperAdminOnly = () => applyDecorators(UseGuards(JwtAuthGuard, RolesGuard), Roles(SUPER_ADMIN));

import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Guard JWT global (APP_GUARD, audit sécurité 1.4) : une route oubliée est fermée par défaut.
 * Seul @Public() posé sur la méthode l'ouvre ; la métadonnée de la classe est volontairement ignorée.
 * JwtAuthGuard reste inchangé pour les @UseGuards(JwtAuthGuard, RolesGuard) existants.
 */
@Injectable()
export class GlobalJwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    if (this.reflector.get<boolean>(IS_PUBLIC_KEY, context.getHandler())) return true;
    return super.canActivate(context);
  }
}

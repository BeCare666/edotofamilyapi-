import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, hasRole } from './roles.decorator';

/**
 * À utiliser APRÈS JwtAuthGuard : @UseGuards(JwtAuthGuard, RolesGuard) + @Roles(...)
 * Sans @Roles, la route reste accessible à tout utilisateur authentifié.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) { }

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!hasRole(user, ...roles)) {
      throw new ForbiddenException('Accès refusé.');
    }
    return true;
  }
}

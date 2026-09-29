import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.services';
import { hasRole, SUPER_PICKUPPOINT } from './roles.decorator';

/**
 * Un point de retrait bloqué (users.is_active = 0) ne peut plus rien faire, même avec
 * un JWT émis avant son blocage (valable 7 jours). À placer après JwtAuthGuard.
 * Sans effet (et sans requête) pour les autres rôles.
 */
@Injectable()
export class ActivePickupGuard implements CanActivate {
  constructor(private readonly db: DatabaseService) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest();
    if (!hasRole(user, SUPER_PICKUPPOINT)) return true;

    const [rows]: any = await this.db.query(
      'SELECT is_active, pickup_approved FROM users WHERE id = ? LIMIT 1',
      [user.id],
    );
    const row = rows?.[0];
    if (!row || Number(row.is_active) === 0 || Number(row.pickup_approved) === 0) {
      throw new ForbiddenException("Votre point de retrait est bloqué. Contactez l'équipe E·Doto Family.");
    }
    return true;
  }
}

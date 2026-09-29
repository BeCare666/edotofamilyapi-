import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Renseigne req.user si un token valide est fourni, sans rejeter les requêtes anonymes.
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any) {
    return err || !user ? null : user;
  }
}

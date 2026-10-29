import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { DatabaseService } from '../database/database.services';
import { cacheSessionRow, cachedSessionRow, isBlocked } from './session';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
    constructor(private readonly db: DatabaseService) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            secretOrKey: process.env.JWT_SECRET_KEY,
        });
    }

    // Audit sécurité 1.5 : le compte est relu (cache 30 s) ; bloqué, supprimé ou version changée → 401
    async validate(payload: any) {
        const id = Number(payload?.id);
        if (!id || typeof payload?.tv !== 'number') throw new UnauthorizedException('Session expirée.');
        // Audit 3.1 : un jeton à usage particulier (défi de double authentification, lien…) n'est jamais une session
        if (payload?.purpose) throw new UnauthorizedException('Session expirée.');

        let row = cachedSessionRow(id);
        if (row === undefined) {
            const [rows]: any = await this.db.query(
                'SELECT id, role, is_active, token_version FROM users WHERE id = ? LIMIT 1',
                [id],
            );
            row = rows?.[0] || null;
            cacheSessionRow(id, row);
        }
        if (!row || isBlocked(row.is_active) || Number(row.token_version) !== payload.tv) {
            throw new UnauthorizedException('Session expirée.');
        }
        return payload;
    }
}

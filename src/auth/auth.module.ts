import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { DatabaseModule } from '../database/database.module';
import { PassportModule } from '@nestjs/passport'; // <== Ajout de cet import manquant
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './jwt.strategy';
import { TotpService } from './totp.service';

@Module({
  imports: [
    DatabaseModule,
    PassportModule.register({ defaultStrategy: 'jwt' }), // Assure l'import de PassportModule
    JwtModule.register({
      // Audit 1.5 : plus de valeur par défaut, main.ts refuse de démarrer sans JWT_SECRET_KEY
      secret: process.env.JWT_SECRET_KEY,
      signOptions: { expiresIn: '1h' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TotpService, JwtStrategy],
  exports: [AuthService, TotpService, JwtStrategy, PassportModule], // Exporter PassportModule pour le guard
})
export class AuthModule { }

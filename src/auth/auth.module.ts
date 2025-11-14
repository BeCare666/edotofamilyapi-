import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { DatabaseModule } from '../database/database.module';
import { PassportModule } from '@nestjs/passport'; // <== Ajout de cet import manquant
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    DatabaseModule,
    PassportModule.register({ defaultStrategy: 'jwt' }), // Assure l'import de PassportModule
    JwtModule.register({
      secret: process.env.JWT_SECRET_KEY || 'default_secret_key', // valeur par défaut si env manquante
      signOptions: { expiresIn: '1h' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtStrategy, PassportModule], // Exporter PassportModule pour le guard
})
export class AuthModule { }

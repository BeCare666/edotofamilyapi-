import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';
import { applySecurity } from './common/cors';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

async function bootstrap() {
  // Audit sécurité 1.5 : sans secret, les jetons seraient signés avec une valeur connue
  if (!process.env.JWT_SECRET_KEY) {
    throw new Error('JWT_SECRET_KEY manquant : démarrage refusé.');
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log', 'debug', 'verbose'], });
  // NestJS 11 / Express 5 (audit 2.1, 26/10/2026) : lecture des paramètres d'URL inchangée (objets et tableaux)
  app.set('query parser', 'extended');
  // Express 5 ne crée plus req.body = {} sans corps : un @Body() vide redevient {} comme avant (au lieu d'un 500)
  app.use((req, _res, next) => {
    if (req.body === undefined) req.body = {};
    next();
  });

  // Audit sécurité 1.3 : en-têtes de sécurité, et CORS limité au site et à l'admin
  applySecurity(app);

  // Préfixe toutes les routes avec /api
  app.setGlobalPrefix('api');

  // Applique les validations DTO globalement
  // class-validator 0.14 (audit 2.1, 26/10/2026) : forbidUnknownValues passe à true par défaut et rejetterait
  // les DTO sans décorateur. Comportement d'avant gardé jusqu'à la validation stricte (2.3).
  app.useGlobalPipes(new ValidationPipe({ forbidUnknownValues: false }));

  // Logger simple pour Render (optionnel)   
  app.use((req, res, next) => {
    console.log(`📥 ${req.method} ${req.url}`);
    next();
  });

  // Swagger config (peut être désactivée en prod si souhaité)
  //
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('edoto family')
      .setDescription('edoto family Mock API')
      .setVersion('1.0')
      .addTag('edoto family')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  // ✅ Render fournit le port via process.env.PORT
  const PORT = parseInt(process.env.PORT, 10) || 5000;
  await app.listen(PORT, '0.0.0.0');
  console.log(`🚀 Application is running on port ${PORT}`);
}


bootstrap();

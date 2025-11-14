import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });
  console.log('JWT_SECRET_KEY:', process.env.JWT_SECRET_KEY);

  // Préfixe toutes les routes avec /api
  app.setGlobalPrefix('api');

  // Applique les validations DTO globalement
  app.useGlobalPipes(new ValidationPipe());

  // 🔍 Logger toutes les requêtes entrantes
  app.use((req, res, next) => {
    console.log('📥 Requête entrante :', req.method, req.url);
    console.log('🔐 Authorization Header :', req.headers.authorization);
    next();
  });

  // Swagger config
  const config = new DocumentBuilder()
    .setTitle('Galileecommerce')
    .setDescription('Galileecommerce Mock API')
    .setVersion('1.0')
    .addTag('galileecommerce')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const PORT = process.env.PORT || 5000;
  await app.listen(PORT, '0.0.0.0');
  console.log(`🚀 Application is running on: ${await app.getUrl()}/api`);
}

bootstrap();

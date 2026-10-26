import express from 'express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import serverlessExpress from '@vendia/serverless-express';
import { Handler } from 'aws-lambda';
import { join } from 'path';
import { ExpressAdapter } from '@nestjs/platform-express';
import * as dotenv from 'dotenv';

if (process.env.NODE_ENV !== 'production') {
    dotenv.config();
}

let server: Handler;

async function bootstrapServer(): Promise<Handler> {
    const expressApp = express();
    const adapter = new ExpressAdapter(expressApp);

    const app = await NestFactory.create(AppModule, adapter, { cors: true });

    app.setGlobalPrefix('api');
    // class-validator 0.14 (audit 2.1, 26/10/2026) : forbidUnknownValues passe à true par défaut et rejetterait
    // les DTO sans décorateur. Comportement d'avant gardé jusqu'à la validation stricte (2.3).
    app.useGlobalPipes(new ValidationPipe({ forbidUnknownValues: false }));
    app.use('/uploads', express.static(join(__dirname, '..', 'uploads')));

    app.use((req, res, next) => {
        console.log('📥 Incoming request:', req.method, req.url);
        console.log('🔐 Authorization Header:', req.headers.authorization);
        next();
    });

    await app.init();

    return serverlessExpress({ app: app.getHttpAdapter().getInstance() });
}

export const handler: Handler = async (event, context) => {
    if (!server) {
        server = await bootstrapServer();
    }
    return server(event, context, () => { });
};

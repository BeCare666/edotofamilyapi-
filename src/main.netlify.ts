import express from 'express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import serverlessExpress from '@vendia/serverless-express';
import { Handler } from 'aws-lambda';
import { join } from 'path';
import { ExpressAdapter } from '@nestjs/platform-express';
import * as dotenv from 'dotenv';
import { StrictBodyPipe } from './common/strict-body';

if (process.env.NODE_ENV !== 'production') {
    dotenv.config();
}

let server: Handler;

async function bootstrapServer(): Promise<Handler> {
    const expressApp = express();
    expressApp.set('query parser', 'extended'); // Express 5 (audit 2.1) : comportement d'avant
    const adapter = new ExpressAdapter(expressApp);

    const app = await NestFactory.create(AppModule, adapter, { cors: true });

    app.setGlobalPrefix('api');
    // Audit sécurité 2.3 (27/10/2026) : liste blanche stricte pour les DTO marqués @StrictDto(),
    // comportement d'avant (forbidUnknownValues: false) pour les autres. Voir src/common/strict-body.ts.
    app.useGlobalPipes(new StrictBodyPipe());
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

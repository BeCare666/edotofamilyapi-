import { Injectable, OnModuleInit } from '@nestjs/common';
import * as mysql from 'mysql2/promise';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

@Injectable()
export class DatabaseSetupService implements OnModuleInit {
  private connection: mysql.Connection;

  async onModuleInit() {
    const isProd = process.env.NODE_ENV === 'production';

    // ✅ chemin cert compatible Nest build (dist ou src).               
    const certPath = join(process.cwd(), '../database/certs/tidb-ca.pem');

    let sslConfig: any = undefined;

    if (existsSync(certPath)) {
      const ca = readFileSync(certPath, 'utf8');
      sslConfig = { ca, rejectUnauthorized: false };
      console.log('✅ Certificat TiDB chargé');
    } else {
      sslConfig = { rejectUnauthorized: false };
      console.warn('⚠️ Certificat TiDB absent — fallback dev SSL relâché');
    }

    // ✅ connexion TiDB Cloud.   
    this.connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'gateway01.eu-central-1.prod.aws.tidbcloud.com',
      user: process.env.DB_USER || '',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'test',
      port: parseInt(process.env.DB_PORT || '4000', 10),
      multipleStatements: true,
      ssl: sslConfig,
    });

    console.log('✅ Connexion TiDB Cloud MySQL établie');

    // ✅ dossier SQL
    const sqlFolder = join(__dirname, 'sql');

    const files = [
      'users.sql',
      'password_resets.sql',
      'avatars.sql',
      'profiles.sql',
      'media.sql',
      'shops.sql',
      'countries.sql',
      'products.sql',
      'categories.sql',
      'sous-categories.sql',
      'sub-categories.sql',
      'corridors.sql',
      'corridors_produits.sql',
      'types.sql',
      'tags.sql',
      'product_categories.sql',
      'product_tags.sql',
      'payment_gateways.sql',
      'payment_methods.sql',
      'questions.sql',
      'feedbacks.sql',
      'orders.sql',
      'order_children.sql',
      'order_files.sql',
      'order_status.sql',
      'payment_intents.sql',
      'analytics.sql',
      'terms_and_conditions.sql',
      'faqs.sql',
      'reviews.sql',
      'taxes.sql',
      'withdraws.sql',
      'invoices.sql',
      'wallet_transactions.sql',
      'settings.sql',
      'notifications.sql',
      'business_documents.sql',
      'vendor_bank_accounts.sql',
      'wallets.sql',
      'withdrawals.sql',
      'pending_payments.sql',
      '001_create_campaigns.sql',
      '002_create_campaign_registrations.sql',
      'campaign_sponsors.sql'
    ];

    for (const file of files) {
      const filePath = join(sqlFolder, file);

      if (!existsSync(filePath)) {
        console.warn(`⚠️ Fichier manquant: ${file}`);
        continue;
      }

      const sql = readFileSync(filePath, 'utf8');

      try {
        await this.connection.query(sql);
        console.log(`✅ Table(s) créée(s) via ${file}`);
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : JSON.stringify(err);
        console.error(`❌ Erreur via ${file} :`, errorMsg);
      }
    }

    await this.connection.end();
    console.log('✅ Connexion fermée après setup');
    console.log('🎉 Toutes les tables sont prêtes !');
  }
}
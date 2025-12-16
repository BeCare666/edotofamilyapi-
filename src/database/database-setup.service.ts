import { Injectable, OnModuleInit } from '@nestjs/common';
import * as mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import { join } from 'path';

@Injectable()
export class DatabaseSetupService implements OnModuleInit {
  private connection;

  async onModuleInit() {
    this.connection = await mysql.createConnection({
      host: 'shinkansen.proxy.rlwy.net',      // ✅ Host Railway
      user: 'root',                           // ✅ Utilisateur
      password: 'fVcRDGvfmnRaQKyCHSwxaTPqpvPeNNoF', // ✅ Nouveau mot de passe.
      database: 'railway',                    // ✅ Base
      port: 47907,                            // ✅ Nouveau port
      multipleStatements: true
    });
    console.log('✅ Connexion MySQL établie');

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
      'pending_payments.sql',
      '001_create_campaigns.sql',
      '002_create_campaign_registrations.sql'
    ];


    for (const file of files) {
      const filePath = join(sqlFolder, file);
      const sql = readFileSync(filePath, 'utf8');
      try {
        await this.connection.query(sql);
        console.log(`Table(s) créée(s) via ${file}`);
      } catch (error) {
        console.error(`Erreur lors de la création via ${file} :`, error);
      }
    }

    await this.connection.end(); // ferme la connexion db
    console.log('✅ Connexion fermée après setup');
    console.log('Toutes les tables sont prêtes !');
  }
}

//host: 'tramway.proxy.rlwy.net'.
//user: 'root',
// password: 'tjqUSbdKCnShXQahtkYrzGRSLOuxsttA',
//database: 'railway',
//port: 20162,
//multipleStatements: true.





import { Injectable } from '@nestjs/common';
import * as mysql from 'mysql2/promise';
import { RowDataPacket, OkPacket, FieldPacket } from 'mysql2';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

type QueryResult = RowDataPacket[] | RowDataPacket[][] | OkPacket | OkPacket[];

@Injectable()
export class DatabaseService {
  private pool: mysql.Pool;

  constructor() {
    // ✅ chemin cert pour Nest build (dist ou src)
    const certPath = join(process.cwd(), '../database/certs/tidb-ca.pem');

    let sslConfig: any;

    if (existsSync(certPath)) {
      const ca = readFileSync(certPath, 'utf8');
      sslConfig = { ca, rejectUnauthorized: false };
      console.log('✅ Certificat TiDB chargé pour pool');
    } else {
      sslConfig = { rejectUnauthorized: false };
      console.warn('⚠️ Certificat TiDB absent — SSL relâché (dev only)');
    }

    // ✅ création du pool MySQL
    this.pool = mysql.createPool({
      host: process.env.DB_HOST || '',
      user: process.env.DB_USER || '',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'test',
      port: parseInt(process.env.DB_PORT || '4000', 10),
      multipleStatements: true,
      connectionLimit: 10,
      queueLimit: 0,
      ssl: sslConfig,
    });

    console.log('✅ Pool TiDB Cloud MySQL initialisé');
  }

  /**
   * Exécute une requête SQL avec paramètres optionnels
   */
  async query<T extends QueryResult = any>(
    sql: string,
    params?: any[]
  ): Promise<[T, FieldPacket[]]> {
    try {
      return await this.pool.execute<T>(sql, params);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : JSON.stringify(err);
      console.error('❌ Erreur SQL :', errorMsg);
      throw err; // remonte l'erreur pour gestion upstream
    }
  }

  /**
   * Récupère le pool MySQL pour transactions ou requêtes avancées
   */
  getPool(): mysql.Pool {
    return this.pool;
  }
}

import { Injectable } from '@nestjs/common';
import * as mysql from 'mysql2/promise';
import { RowDataPacket, OkPacket, FieldPacket } from 'mysql2';

type QueryResult = RowDataPacket[] | RowDataPacket[][] | OkPacket | OkPacket[];

@Injectable()
export class DatabaseService {
  private pool: mysql.Pool;

  constructor() {
    this.pool = mysql.createPool({
      host: 'shinkansen.proxy.rlwy.net',      // ✅ Host Railway.
      user: 'root',                           // ✅ Utilisateur
      password: 'fVcRDGvfmnRaQKyCHSwxaTPqpvPeNNoF', // ✅ Nouveau mot de passe
      database: 'railway',                    // ✅ Base
      port: 47907,                            // ✅ Nouveau port
      multipleStatements: true,
      connectionLimit: 10,
      queueLimit: 0,
    });

    console.log('✅ Pool MySQL initialisé');
  }

  async query<T extends QueryResult = any>(
    sql: string,
    params?: any[]
  ): Promise<[T, FieldPacket[]]> {
    return this.pool.execute<T>(sql, params);
  }

  // ✅ Ajout sécurisé : exposer le pool si on veut faire des requêtes non préparées (query).    
  getPool(): mysql.Pool {
    return this.pool;
  }
}

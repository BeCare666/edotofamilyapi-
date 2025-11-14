import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.services';
import { OkPacket } from 'mysql2';

@Injectable()
export class UploadsService {
  constructor(private readonly db: DatabaseService) { }

  async saveFile({
    user_id,
    url,
    key,
    mime_type,
    size,
    original_name,
  }: {
    user_id: number;
    url: string;
    key: string;
    mime_type: string;
    size: number;
    original_name: string;
  }) {
    // 🔹 Affiche le fichier reçu avant l'insertion
    console.log('📤 Fichier reçu pour upload :', {
      user_id,
      url,
      key,
      mime_type,
      size,
      original_name,
    });
    const [result]: [OkPacket, any] = await this.db.query<OkPacket>(
      `INSERT INTO media (user_id, url, key, mime_type, size, original_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [user_id, url, key, mime_type, size, original_name],
    );

    // retourner l'objet inséré dans la db
    return {
      id: result.insertId,
      user_id,
      url,
      key,
      mime_type,
      size,
      original_name,
    };
  }
}

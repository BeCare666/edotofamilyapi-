import { BadRequestException, Body, Controller, Delete, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { cleanBirthDate, cleanName, cleanOrgName, cleanPhone, cleanSex } from '../common/field-rules';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DatabaseService } from '../database/database.services';

// Photo de profil (16/10/2026) : tout compte connecté (utilisateur, sponsor, point de retrait,
// admin) peut envoyer, remplacer ou retirer SA photo. Image JPEG, PNG ou WebP de 3 Mo au plus,
// recadrée en carré 512 × 512 par Cloudinary. Enregistrée dans la table avatars, à laquelle
// profiles.avatar_id est relié par clé étrangère en production (vérifié le 16/10/2026), lue par GET /me.
export const PHOTO_MAX_BYTES = 3 * 1024 * 1024;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Vérification du contenu réel (signature du fichier), pas seulement du type annoncé
export function isRealImage(buf: Buffer | undefined): boolean {
  if (!buf || buf.length < 12) return false;
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const png = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
  return jpeg || png || webp;
}

export type PhotoUploader = (buf: Buffer, userId: number) => Promise<{ url: string; key: string; size: number }>;

const cloudinaryUploader: PhotoUploader = (buf, userId) =>
  new Promise((resolve, reject) => {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'avatars',
        resource_type: 'image',
        public_id: `user_${userId}_${Date.now()}`,
        transformation: [{ width: 512, height: 512, crop: 'fill', gravity: 'face' }],
        format: 'jpg',
      },
      (err, res?: UploadApiResponse) => (err || !res ? reject(err) : resolve({ url: res.secure_url, key: res.public_id, size: res.bytes })),
    );
    stream.end(buf);
  });

@Controller('me')
export class ProfilePhotoController {
  // Remplaçable dans les tests
  static uploader: PhotoUploader = cloudinaryUploader;

  constructor(private readonly db: DatabaseService) {}

  @UseGuards(JwtAuthGuard)
  @Post('photo')
  @UseInterceptors(FileInterceptor('photo', { storage: memoryStorage(), limits: { fileSize: PHOTO_MAX_BYTES, files: 1 } }))
  async upload(@UploadedFile() file: Express.Multer.File, @Req() req: any) {
    const userId = Number(req.user?.id);
    if (!userId) throw new BadRequestException('Compte introuvable.');
    if (!file) throw new BadRequestException('Choisissez une photo.');
    if (!PHOTO_TYPES.includes(file.mimetype) || !isRealImage(file.buffer)) {
      throw new BadRequestException('Format non accepté : choisissez une photo JPEG, PNG ou WebP.');
    }
    let up: { url: string; key: string; size: number };
    try {
      up = await ProfilePhotoController.uploader(file.buffer, userId);
    } catch {
      throw new BadRequestException("La photo n'a pas pu être enregistrée. Réessayez dans un instant.");
    }
    const pool = this.db.getPool();
    const thumb = up.url.replace('/upload/', '/upload/c_fill,w_128,h_128/');
    const [ins]: any = await pool.query('INSERT INTO avatars (original, thumbnail) VALUES (?, ?)', [up.url, thumb]);
    const mediaId = Number(ins.insertId);
    const [[profile]]: any = await pool.query('SELECT id FROM profiles WHERE customer_id = ? LIMIT 1', [userId]);
    if (profile) await pool.query('UPDATE profiles SET avatar_id = ?, updated_at = NOW() WHERE customer_id = ?', [mediaId, userId]);
    else await pool.query('INSERT INTO profiles (customer_id, avatar_id, created_at, updated_at) VALUES (?, ?, NOW(), NOW())', [userId, mediaId]);
    return { avatar: { id: mediaId, url: up.url, original: up.url, thumbnail: thumb }, message: 'Photo de profil mise à jour.' };
  }

  // Profil de la personne connectée (16/10/2026) : nom et téléphone modifiables ; date de naissance
  // et sexe seulement s'ils manquent (ensuite verrouillés : ils servent au ciblage des campagnes).
  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  async updateProfile(@Body() body: any, @Req() req: any) {
    const userId = Number(req.user?.id);
    if (!userId) throw new BadRequestException('Compte introuvable.');
    const pool = this.db.getPool();
    const [[u]]: any = await pool.query(
      `SELECT id, role, sex, DATE_FORMAT(birth_date, '%Y-%m-%d') AS birth_date FROM users WHERE id = ?`,
      [userId],
    );
    if (!u) throw new BadRequestException('Compte introuvable.');
    const sets: string[] = [];
    const params: any[] = [];
    if (body?.name !== undefined) {
      const isOrg = u.role === 'super_pickuppoint' || u.role === 'sponsor';
      sets.push('name = ?');
      params.push(isOrg ? cleanOrgName(body.name) : cleanName(body.name, 'Le nom complet'));
    }
    if (body?.birth_date !== undefined && body.birth_date !== (u.birth_date ?? '')) {
      if (u.birth_date) throw new BadRequestException('La date de naissance est déjà renseignée : contactez E.doto family pour la corriger.');
      sets.push('birth_date = ?');
      params.push(cleanBirthDate(body.birth_date));
    }
    if (body?.sex !== undefined && body.sex !== (u.sex ?? '')) {
      if (u.sex) throw new BadRequestException('Le sexe est déjà renseigné : contactez E.doto family pour le corriger.');
      sets.push('sex = ?');
      params.push(cleanSex(body.sex));
    }
    if (sets.length) {
      await pool.query(`UPDATE users SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`, [...params, userId]);
    }
    if (body?.phone !== undefined) {
      const phone = cleanPhone(body.phone, { required: false });
      const [[profile]]: any = await pool.query('SELECT id FROM profiles WHERE customer_id = ? LIMIT 1', [userId]);
      if (profile) await pool.query('UPDATE profiles SET contact = ?, updated_at = NOW() WHERE customer_id = ?', [phone, userId]);
      else await pool.query('INSERT INTO profiles (customer_id, contact, created_at, updated_at) VALUES (?, ?, NOW(), NOW())', [userId, phone]);
    }
    return { success: true, message: 'Profil mis à jour.' };
  }

  @UseGuards(JwtAuthGuard)
  @Delete('photo')
  async remove(@Req() req: any) {
    const userId = Number(req.user?.id);
    if (!userId) throw new BadRequestException('Compte introuvable.');
    await this.db.getPool().query('UPDATE profiles SET avatar_id = NULL, updated_at = NOW() WHERE customer_id = ?', [userId]);
    return { avatar: null, message: 'Photo de profil retirée.' };
  }
}

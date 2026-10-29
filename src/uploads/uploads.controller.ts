import { Controller, Post, UploadedFiles, UseInterceptors, BadRequestException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, SUPER_ADMIN, STORE_OWNER, STAFF } from '../auth/roles.decorator';
import { FilesInterceptor } from '@nestjs/platform-express';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { memoryStorage } from 'multer';
import { isRealImage } from '../users/profile-photo.controller';

// Fichiers de l'admin (audit sécurité 2.8, 29/10/2026) : 5 Mo au plus par fichier, 10 fichiers,
// JPEG, PNG, WebP ou PDF, contrôlés par leurs premiers octets (pas seulement le type annoncé).
// Les fichiers sont gardés en mémoire le temps du contrôle, puis envoyés à Cloudinary.
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_MAX_FILES = 10;
export const ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export function isRealPdf(buf: Buffer | undefined): boolean {
  return !!buf && buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-';
}

export function isAcceptedAttachment(file: Pick<Express.Multer.File, 'mimetype' | 'buffer'>): boolean {
  if (!ATTACHMENT_TYPES.includes(file.mimetype)) return false;
  return file.mimetype === 'application/pdf' ? isRealPdf(file.buffer) : isRealImage(file.buffer);
}

export type AttachmentUploader = (file: Express.Multer.File) => Promise<{ url: string; key: string; size: number }>;

const cloudinaryUploader: AttachmentUploader = (file) =>
  new Promise((resolve, reject) => {
    // Config Cloudinary : lue à l'exécution (le .env est chargé après l'import de ce module)
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    // Comme avant : PNG gardé en PNG, autres images en JPG ; PDF gardé tel quel
    const format = file.mimetype === 'application/pdf' ? 'pdf' : file.mimetype.includes('png') ? 'png' : 'jpg';
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'uploads', resource_type: 'image', format },
      (err, res?: UploadApiResponse) => (err || !res ? reject(err) : resolve({ url: res.secure_url, key: res.public_id, size: res.bytes })),
    );
    stream.end(file.buffer);
  });

@Controller('attachments')
export class UploadsController {
  // Remplaçable dans les tests
  static uploader: AttachmentUploader = cloudinaryUploader;

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(SUPER_ADMIN, STORE_OWNER, STAFF)
  @Post()
  @UseInterceptors(
    FilesInterceptor('attachment', ATTACHMENT_MAX_FILES, {
      storage: memoryStorage(),
      limits: { fileSize: ATTACHMENT_MAX_BYTES, files: ATTACHMENT_MAX_FILES },
    }),
  )
  async uploadFile(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }
    const refused = files.filter((f) => !isAcceptedAttachment(f));
    if (refused.length) {
      throw new BadRequestException('Format non accepté : JPEG, PNG, WebP ou PDF de 5 Mo au plus.');
    }

    const uploaded = [];
    for (const file of files) {
      let up: { url: string; key: string; size: number };
      try {
        up = await UploadsController.uploader(file);
      } catch {
        throw new BadRequestException("Le fichier n'a pas pu être enregistré. Réessayez dans un instant.");
      }
      uploaded.push({
        originalName: file.originalname,
        filename: up.key,
        size: up.size,
        mimeType: file.mimetype,
        url: up.url, // URL publique Cloudinary
        key: up.key,
      });
    }
    return uploaded;
  }
}

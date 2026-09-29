import { Controller, Post, UploadedFiles, UseInterceptors, BadRequestException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, SUPER_ADMIN, STORE_OWNER, STAFF } from '../auth/roles.decorator';
import { FilesInterceptor } from '@nestjs/platform-express';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import * as multer from 'multer';

// Config Cloudinary : lue à l'exécution (le .env est chargé après l'import de ce module)
function configureCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

// Storage Cloudinary compatible TS
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    configureCloudinary();
    return {
      folder: 'uploads',       // dossier dans Cloudinary
      resource_type: 'image',  // obligatoire
      format: file.mimetype.includes('png') ? 'png' : 'jpg', // ou autre logique
    };
  },
});

@Controller('attachments')
export class UploadsController {
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(SUPER_ADMIN, STORE_OWNER, STAFF)
  @Post()
  @UseInterceptors(FilesInterceptor('attachment', 10, { storage }))
  async uploadFile(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }

    return files.map(file => ({
      originalName: file.originalname,
      filename: file.filename,
      size: file.size,
      mimeType: file.mimetype,
      url: file.path, // URL publique Cloudinary
      key: file.filename,
    }));
  }
}

import { Controller, Post, UploadedFiles, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import * as multer from 'multer';

// Config Cloudinary
cloudinary.config({
  cloud_name: 'dxug9vkcd',// process.env.CLOUDINARY_CLOUD_NAME,
  api_key: '157518177599353',//process.env.CLOUDINARY_API_KEY,
  api_secret: 'in7j-BzRT8z_nCHWQ1JXpDuYhfU', //process.env.CLOUDINARY_API_SECRET,
});

// Storage Cloudinary compatible TS
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => ({
    folder: 'uploads',       // dossier dans Cloudinary
    resource_type: 'image',  // obligatoire
    format: file.mimetype.includes('png') ? 'png' : 'jpg', // ou autre logique
  }),
});

@Controller('attachments')
export class UploadsController {
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

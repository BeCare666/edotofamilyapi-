import { diskStorage } from 'multer';
import { extname } from 'path';
import * as fs from 'fs';
import { join } from 'path';

const uploadPath = join(__dirname, '../../uploads');

if (!fs.existsSync(uploadPath)) {
    fs.mkdirSync(uploadPath, { recursive: true });
}

export const multerOptions = {
    storage: diskStorage({
        destination: uploadPath,
        filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
            const ext = extname(file.originalname);
            cb(null, `${uniqueSuffix}${ext}`);
        },
    }),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
    fileFilter: (req, file, cb) => {
        // Accepte images/pdf seulement (optionnel)
        if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|pdf)$/)) {
            return cb(new Error('Type de fichier non supporté'), false);
        }
        cb(null, true);
    },
};
// Usage dans le controller

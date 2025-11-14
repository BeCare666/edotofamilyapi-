export interface S3UploadedFile extends Express.Multer.File {
    location: string;  // URL publique
    key: string;       // nom du fichier dans le bucket
}

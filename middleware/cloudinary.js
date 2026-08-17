import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from 'cloudinary';
import multer from 'multer';

cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary.v2,
  params: {
    folder: 'email_attachments',
    resource_type: 'auto',
  },
});

export const uploadAttachmentsMulter = multer({
  storage,
  limits: {
    fileSize: 30 * 1024 * 1024,
  },
});

export const uploadBufferToCloudinary = (fileBuffer, filename = 'attachment') => {
  return new Promise((resolve) => {
    if (!fileBuffer) return resolve(null);
    const cleanFilename = String(filename).replace(/[^a-zA-Z0-9.-]/g, '_');
    const uploadStream = cloudinary.v2.uploader.upload_stream(
      {
        folder: 'email_attachments',
        resource_type: 'auto',
        public_id: `${Date.now()}_${cleanFilename}`,
      },
      (error, result) => {
        if (error) {
          console.error('❌ Cloudinary stream upload error:', error);
          resolve(null);
        } else {
          resolve(result?.secure_url || null);
        }
      }
    );
    uploadStream.end(fileBuffer);
  });
};

export const cpUpload = uploadAttachmentsMulter.fields([
  { name: 'images', maxCount: 10 },
  { name: 'image', maxCount: 10 },
  { name: 'file', maxCount: 10 },
  { name: 'variantImages', maxCount: 10 },
  { name: 'files', maxCount: 10 },
  { name: 'attachments', maxCount: 10 },
]);

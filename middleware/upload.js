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
    folder: 'uploads',
    allowed_formats: ['jpg', 'png', 'jpeg', 'pdf', 'doc', 'docx', 'ppt', 'csv'],
    resource_type: 'image',
  },
});

// export const upload = multer({ storage })
const upload = multer({
  storage,
  limits: {
    fileSize: 30 * 1024 * 1024,
  },
});

export const cpUploads = upload.fields([
  { name: 'images', maxCount: 10 },
  { name: 'image', maxCount: 10 },
  { name: 'file', maxCount: 10 },
  { name: 'variantImages', maxCount: 10 },
  { name: 'files', maxCount: 10 },
]);

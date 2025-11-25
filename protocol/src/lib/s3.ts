import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const BUCKET_NAME = process.env.AWS_S3_FEEDBACK_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;

/**
 * Uploads a base64 encoded image to S3
 * @param base64Image The base64 string of the image (can include data URI prefix)
 * @param folder The folder path in the bucket (optional)
 * @returns The public URL of the uploaded image
 */
export async function uploadBase64ImageToS3(base64Image: string, folder: string = 'feedback'): Promise<string> {
  if (!BUCKET_NAME) {
    throw new Error('AWS_S3_BUCKET_NAME is not configured');
  }

  // Remove data URI prefix if present (e.g., "data:image/png;base64,")
  const matches = base64Image.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  let buffer: Buffer;
  let contentType = 'image/png'; // Default

  if (matches && matches.length === 3) {
    contentType = matches[1];
    buffer = Buffer.from(matches[2], 'base64');
  } else {
    // Assume raw base64 if no prefix
    buffer = Buffer.from(base64Image, 'base64');
  }

  const extension = contentType.split('/')[1] || 'png';
  const fileName = `${folder}/${uuidv4()}.${extension}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: fileName,
    Body: buffer,
    ContentType: contentType,
    // ACL: 'public-read', // Optional: depends on bucket settings. Usually better to use bucket policy.
  });

  await s3Client.send(command);

  // Return the URL
  // Assuming standard S3 URL format. If using CloudFront, this would be different.
  return `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${fileName}`;
}

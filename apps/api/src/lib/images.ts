import sharp from 'sharp';
import { AppError } from './errors';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Checks the real bytes, never the file name or the Content-Type the browser claims.
// Only PNG, JPEG and WebP: no SVG (it can carry scripts), no GIF.
export function looksLikeImage(buf: Buffer): boolean {
  const jpeg = buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const png = buf.length >= 8 && buf.subarray(0, 8).equals(PNG_MAGIC);
  const webp =
    buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
  return jpeg || png || webp;
}

// Validates and re-encodes an upload to WebP. The re-encode drops EXIF and any hidden payload.
// `resize` decides the output size (avatar: square crop, cover: max width).
export async function toWebp(file: Buffer, resize: (img: sharp.Sharp) => sharp.Sharp): Promise<Buffer> {
  if (!looksLikeImage(file)) throw new AppError(400, 'Only PNG, JPEG or WebP images are allowed');
  try {
    const img = sharp(file, { limitInputPixels: 24_000_000 }).rotate(); // apply camera orientation first
    return await resize(img).webp({ quality: 80 }).toBuffer();
  } catch {
    throw new AppError(400, 'That image could not be read');
  }
}
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { putObject, deleteObject, mediaUrl } from '../lib/storage';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Checks the real bytes, never the file name or the Content-Type the browser claims.
// Only PNG, JPEG and WebP: no SVG (it can carry scripts), no GIF.
function looksLikeImage(buf: Buffer): boolean {
  const jpeg = buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const png = buf.length >= 8 && buf.subarray(0, 8).equals(PNG_MAGIC);
  const webp =
    buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
  return jpeg || png || webp;
}

export async function setAvatar(userId: string, file: Buffer) {
  if (!looksLikeImage(file)) throw new AppError(400, 'Only PNG, JPEG or WebP images are allowed');

  // Re-encoding drops EXIF and any non-image payload hidden in the file.
  let image: Buffer;
  try {
    image = await sharp(file, { limitInputPixels: 24_000_000 })
      .rotate() // apply the camera orientation before the metadata is stripped
      .resize(256, 256, { fit: 'cover' })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    throw new AppError(400, 'That image could not be read');
  }

  const current = await prisma.user.findUnique({ where: { id: userId }, select: { avatarKey: true } });
  if (!current) throw new AppError(401, 'Not logged in');

  // A new key per upload: the old URL stays cached by browsers, the new one is always fresh.
  const key = `avatars/${userId}/${randomUUID()}.webp`;
  try {
    await putObject(key, image, 'image/webp');
  } catch (err) {
    console.error('Avatar upload to storage failed:', err);
    throw new AppError(503, 'Image storage is unavailable, please try again later');
  }

  try {
    await prisma.user.update({ where: { id: userId }, data: { avatarKey: key } });
  } catch (err) {
    await deleteObject(key); // don't leave an unreferenced object behind
    throw err;
  }

  if (current.avatarKey) await deleteObject(current.avatarKey);
  return { avatarUrl: mediaUrl(key) };
}

// Repeatable: removing when there is no avatar is fine.
export async function removeAvatar(userId: string) {
  const current = await prisma.user.findUnique({ where: { id: userId }, select: { avatarKey: true } });
  if (!current) throw new AppError(401, 'Not logged in');
  if (current.avatarKey) {
    await prisma.user.update({ where: { id: userId }, data: { avatarKey: null } });
    await deleteObject(current.avatarKey);
  }
  return { avatarUrl: null };
}
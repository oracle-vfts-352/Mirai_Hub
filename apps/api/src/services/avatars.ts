import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { putObject, deleteObject, mediaUrl } from '../lib/storage';
import { toWebp } from '../lib/images';

export async function setAvatar(userId: string, file: Buffer) {
  const image = await toWebp(file, (img) => img.resize(256, 256, { fit: 'cover' }));

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
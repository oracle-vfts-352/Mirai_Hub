import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
import { prisma } from '../src/lib/prisma';
import { putObject, deleteObject } from '../src/lib/storage';
import { anon, scenario, makeFeedback } from './helpers';

// A real 600x400 PNG, so the re-encode has something to do
const makePng = () =>
  sharp({ create: { width: 600, height: 400, channels: 3, background: '#2255cc' } }).png().toBuffer();

const png = { filename: 'me.png', contentType: 'image/png' };

describe('avatar upload', () => {
  it('requires login for upload and removal', async () => {
    expect((await anon().post('/api/me/avatar')).status).toBe(401);
    expect((await anon().delete('/api/me/avatar')).status).toBe(401);
  });

  it('rejects a request without a file (400)', async () => {
    const { fan1Api } = await scenario();
    expect((await fan1Api.post('/api/me/avatar')).status).toBe(400);
  });

  it('rejects a file that is not an image, whatever it claims to be (400)', async () => {
    const { fan1Api } = await scenario();
    const res = await fan1Api.post('/api/me/avatar').attach('avatar', Buffer.from('not an image at all'), png);
    expect(res.status).toBe(400);
    expect(putObject).not.toHaveBeenCalled();
  });

  it('rejects SVG (400)', async () => {
    const { fan1Api } = await scenario();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const res = await fan1Api
      .post('/api/me/avatar')
      .attach('avatar', svg, { filename: 'me.svg', contentType: 'image/svg+xml' });
    expect(res.status).toBe(400);
    expect(putObject).not.toHaveBeenCalled();
  });

  it('rejects a file over 2 MB (413)', async () => {
    const { fan1Api } = await scenario();
    const big = Buffer.alloc(2 * 1024 * 1024 + 1024, 1);
    const res = await fan1Api.post('/api/me/avatar').attach('avatar', big, png);
    expect(res.status).toBe(413);
    expect(putObject).not.toHaveBeenCalled();
  });

  it('stores a 256x256 WebP under a server-chosen key', async () => {
    const { fan1, fan1Api } = await scenario();
    const res = await fan1Api.post('/api/me/avatar').attach('avatar', await makePng(), png);
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { id: fan1.id } });
    expect(user?.avatarKey).toMatch(new RegExp(`^avatars/${fan1.id}/[0-9a-f-]{36}\\.webp$`));
    expect(res.body.avatarUrl).toBe(`http://media.test/${user?.avatarKey}`);

    expect(putObject).toHaveBeenCalledTimes(1);
    const [key, body, type] = vi.mocked(putObject).mock.calls[0];
    expect(key).toBe(user?.avatarKey);
    expect(type).toBe('image/webp');
    const meta = await sharp(body).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(256);
    expect(meta.exif).toBeUndefined();
  });

  it('the public profile shows avatarUrl and never the storage key', async () => {
    const { fan1, fan1Api } = await scenario();
    await fan1Api.post('/api/me/avatar').attach('avatar', await makePng(), png).expect(200);
    const user = await prisma.user.findUnique({ where: { id: fan1.id } });

    const profile = await anon().get(`/api/users/${fan1.id}`);
    expect(profile.status).toBe(200);
    expect(profile.body.avatarUrl).toBe(`http://media.test/${user?.avatarKey}`);
    expect(profile.body).not.toHaveProperty('avatarKey');
  });

  it('a profile without an avatar has avatarUrl null', async () => {
    const { fan2 } = await scenario();
    const profile = await anon().get(`/api/users/${fan2.id}`);
    expect(profile.body.avatarUrl).toBeNull();
  });

  it('replacing the avatar deletes the old object', async () => {
    const { fan1, fan1Api } = await scenario();
    await fan1Api.post('/api/me/avatar').attach('avatar', await makePng(), png).expect(200);
    await fan1Api.post('/api/me/avatar').attach('avatar', await makePng(), png).expect(200);

    const firstKey = vi.mocked(putObject).mock.calls[0][0];
    const secondKey = vi.mocked(putObject).mock.calls[1][0];
    expect(firstKey).not.toBe(secondKey);
    expect(deleteObject).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledWith(firstKey);
    const user = await prisma.user.findUnique({ where: { id: fan1.id } });
    expect(user?.avatarKey).toBe(secondKey);
  });

  it('removing clears the avatar, deletes the object, and is repeatable', async () => {
    const { fan1, fan1Api } = await scenario();
    await fan1Api.post('/api/me/avatar').attach('avatar', await makePng(), png).expect(200);
    const key = vi.mocked(putObject).mock.calls[0][0];

    const res = await fan1Api.delete('/api/me/avatar');
    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).toBeNull();
    expect(deleteObject).toHaveBeenCalledWith(key);
    expect((await prisma.user.findUnique({ where: { id: fan1.id } }))?.avatarKey).toBeNull();

    await fan1Api.delete('/api/me/avatar').expect(200);
    expect(deleteObject).toHaveBeenCalledTimes(1);
  });

  it('feedback authors carry avatarUrl, never the storage key', async () => {
    const { fan1, project } = await scenario();
    await prisma.user.update({ where: { id: fan1.id }, data: { avatarKey: 'avatars/x/y.webp' } });
    await makeFeedback(project.id, fan1.id);

    const list = await anon().get(`/api/projects/${project.slug}/feedback`);
    expect(list.body[0].author).toEqual({
      id: fan1.id,
      name: 'fan1',
      avatarUrl: 'http://media.test/avatars/x/y.webp',
    });
  });
});
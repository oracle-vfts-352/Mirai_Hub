import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { putObject, deleteObject } from '../src/lib/storage';
import { anon, scenario, makeUser, loginAs } from './helpers';

const makePng = (width = 600, height = 400) =>
  sharp({ create: { width, height, channels: 3, background: '#2255cc' } }).png().toBuffer();

const png = { filename: 'cover.png', contentType: 'image/png' };

function makePost(projectId: string) {
  return prisma.post.create({
    data: { projectId, type: 'ANNOUNCEMENT', title: 'v0.2 is out', body: 'x' },
  });
}

describe('post cover images', () => {
  it('requires login for upload and removal', async () => {
    expect((await anon().post(`/api/posts/${randomUUID()}/cover`)).status).toBe(401);
    expect((await anon().delete(`/api/posts/${randomUUID()}/cover`)).status).toBe(401);
  });

  it('a consumer cannot upload (403) and nothing is stored', async () => {
    const { project, fan1Api } = await scenario();
    const post = await makePost(project.id);
    const res = await fan1Api.post(`/api/posts/${post.id}/cover`).attach('cover', await makePng(), png);
    expect(res.status).toBe(403);
    expect(putObject).not.toHaveBeenCalled();
  });

  it('a DEV who does not own the project cannot upload or remove (403)', async () => {
    const { project } = await scenario();
    const post = await makePost(project.id);
    const other = await makeUser('otherdev', 'DEV');
    const otherApi = await loginAs(other.email);
    const up = await otherApi.post(`/api/posts/${post.id}/cover`).attach('cover', await makePng(), png);
    expect(up.status).toBe(403);
    expect((await otherApi.delete(`/api/posts/${post.id}/cover`)).status).toBe(403);
    expect(putObject).not.toHaveBeenCalled();
  });

  it('rejects a request without a file (400)', async () => {
    const { project, ownerApi } = await scenario();
    const post = await makePost(project.id);
    expect((await ownerApi.post(`/api/posts/${post.id}/cover`)).status).toBe(400);
  });

  it('rejects a file that is not an image, whatever it claims to be (400)', async () => {
    const { project, ownerApi } = await scenario();
    const post = await makePost(project.id);
    const res = await ownerApi
      .post(`/api/posts/${post.id}/cover`)
      .attach('cover', Buffer.from('not an image at all'), png);
    expect(res.status).toBe(400);
    expect(putObject).not.toHaveBeenCalled();
  });

  it('rejects SVG (400)', async () => {
    const { project, ownerApi } = await scenario();
    const post = await makePost(project.id);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const res = await ownerApi
      .post(`/api/posts/${post.id}/cover`)
      .attach('cover', svg, { filename: 'c.svg', contentType: 'image/svg+xml' });
    expect(res.status).toBe(400);
    expect(putObject).not.toHaveBeenCalled();
  });

  it('rejects a file over 5 MB (413)', async () => {
    const { project, ownerApi } = await scenario();
    const post = await makePost(project.id);
    const big = Buffer.alloc(5 * 1024 * 1024 + 1024, 1);
    const res = await ownerApi.post(`/api/posts/${post.id}/cover`).attach('cover', big, png);
    expect(res.status).toBe(413);
    expect(putObject).not.toHaveBeenCalled();
  });

  it('the owner can upload: a WebP at most 1600 px wide under a server-chosen key', async () => {
    const { project, ownerApi } = await scenario();
    const post = await makePost(project.id);
    const res = await ownerApi
      .post(`/api/posts/${post.id}/cover`)
      .attach('cover', await makePng(2400, 1200), png);
    expect(res.status).toBe(200);

    const stored = await prisma.post.findUnique({ where: { id: post.id } });
    expect(stored?.coverKey).toMatch(new RegExp(`^covers/${post.id}/[0-9a-f-]{36}\\.webp$`));
    expect(res.body.coverUrl).toBe(`http://media.test/${stored?.coverKey}`);

    const [key, body, type] = vi.mocked(putObject).mock.calls[0];
    expect(key).toBe(stored?.coverKey);
    expect(type).toBe('image/webp');
    const meta = await sharp(body).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(1600);
    expect(meta.height).toBe(800);
    expect(meta.exif).toBeUndefined();
  });

  it('a small image is not enlarged', async () => {
    const { project, ownerApi } = await scenario();
    const post = await makePost(project.id);
    await ownerApi.post(`/api/posts/${post.id}/cover`).attach('cover', await makePng(400, 300), png).expect(200);
    const meta = await sharp(vi.mocked(putObject).mock.calls[0][1]).metadata();
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(300);
  });

  it('replacing the cover deletes the old object', async () => {
    const { project, ownerApi } = await scenario();
    const post = await makePost(project.id);
    await ownerApi.post(`/api/posts/${post.id}/cover`).attach('cover', await makePng(), png).expect(200);
    await ownerApi.post(`/api/posts/${post.id}/cover`).attach('cover', await makePng(), png).expect(200);

    const first = vi.mocked(putObject).mock.calls[0][0];
    const second = vi.mocked(putObject).mock.calls[1][0];
    expect(first).not.toBe(second);
    expect(deleteObject).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledWith(first);
    expect((await prisma.post.findUnique({ where: { id: post.id } }))?.coverKey).toBe(second);
  });

  it('removing clears the cover, deletes the object, and is repeatable', async () => {
    const { project, ownerApi } = await scenario();
    const post = await makePost(project.id);
    await ownerApi.post(`/api/posts/${post.id}/cover`).attach('cover', await makePng(), png).expect(200);
    const key = vi.mocked(putObject).mock.calls[0][0];

    const res = await ownerApi.delete(`/api/posts/${post.id}/cover`);
    expect(res.status).toBe(200);
    expect(res.body.coverUrl).toBeNull();
    expect(deleteObject).toHaveBeenCalledWith(key);
    expect((await prisma.post.findUnique({ where: { id: post.id } }))?.coverKey).toBeNull();

    await ownerApi.delete(`/api/posts/${post.id}/cover`).expect(200);
    expect(deleteObject).toHaveBeenCalledTimes(1);
  });

  it('deleting the post deletes its cover object', async () => {
    const { project, ownerApi } = await scenario();
    const post = await makePost(project.id);
    await ownerApi.post(`/api/posts/${post.id}/cover`).attach('cover', await makePng(), png).expect(200);
    const key = vi.mocked(putObject).mock.calls[0][0];

    await ownerApi.delete(`/api/posts/${post.id}`).expect(200);
    expect(deleteObject).toHaveBeenCalledWith(key);
  });

  it('post payloads carry coverUrl and never the storage key', async () => {
    const { project, ownerApi } = await scenario();
    const created = await ownerApi
      .post(`/api/projects/${project.slug}/posts`)
      .send({ type: 'ANNOUNCEMENT', title: 'Hello', body: 'x' });
    expect(created.status).toBe(201);
    expect(created.body.coverUrl).toBeNull();
    expect(created.body).not.toHaveProperty('coverKey');

    await prisma.post.update({ where: { id: created.body.id }, data: { coverKey: 'covers/a/b.webp' } });
    const list = await anon().get(`/api/projects/${project.slug}/posts`);
    expect(list.body[0].coverUrl).toBe('http://media.test/covers/a/b.webp');
    expect(list.body[0]).not.toHaveProperty('coverKey');

    const edited = await ownerApi.patch(`/api/posts/${created.body.id}`).send({ title: 'Hello again' });
    expect(edited.body.coverUrl).toBe('http://media.test/covers/a/b.webp');
    expect(edited.body).not.toHaveProperty('coverKey');
  });

  it('the feed carries coverUrl too', async () => {
    const { project } = await scenario();
    const post = await makePost(project.id);
    await prisma.post.update({ where: { id: post.id }, data: { coverKey: 'covers/x/y.webp' } });
    const feed = await anon().get('/api/feed');
    expect(feed.body[0].coverUrl).toBe('http://media.test/covers/x/y.webp');
    expect(feed.body[0]).not.toHaveProperty('coverKey');
  });

  it('unknown post is 404 and a non-UUID id is 400', async () => {
    const { ownerApi } = await scenario();
    const up = await ownerApi.post(`/api/posts/${randomUUID()}/cover`).attach('cover', await makePng(), png);
    expect(up.status).toBe(404);
    expect((await ownerApi.delete(`/api/posts/${randomUUID()}/cover`)).status).toBe(404);
    const bad = await ownerApi.post('/api/posts/not-a-uuid/cover').attach('cover', await makePng(), png);
    expect(bad.status).toBe(400);
  });
});
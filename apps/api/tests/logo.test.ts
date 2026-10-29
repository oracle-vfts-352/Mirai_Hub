import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { putObject, deleteObject } from '../src/lib/storage';
import { anon, scenario, makeUser, loginAs } from './helpers';

// A wide 600x200 PNG, like a wordmark: it must be fitted inside the square, not cropped
const makePng = (width = 600, height = 200) =>
  sharp({ create: { width, height, channels: 3, background: '#cc2255' } }).png().toBuffer();

const png = { filename: 'logo.png', contentType: 'image/png' };

describe('project logo', () => {
  it('requires login for upload and removal', async () => {
    expect((await anon().post(`/api/projects/${randomUUID()}/logo`)).status).toBe(401);
    expect((await anon().delete(`/api/projects/${randomUUID()}/logo`)).status).toBe(401);
  });

  it('a consumer cannot upload (403) and nothing is stored', async () => {
    const { project, fan1Api } = await scenario();
    const res = await fan1Api.post(`/api/projects/${project.id}/logo`).attach('logo', await makePng(), png);
    expect(res.status).toBe(403);
    expect(putObject).not.toHaveBeenCalled();
  });

  it('a DEV who does not own the project cannot upload or remove (403)', async () => {
    const { project } = await scenario();
    const other = await makeUser('otherdev', 'DEV');
    const otherApi = await loginAs(other.email);
    const up = await otherApi.post(`/api/projects/${project.id}/logo`).attach('logo', await makePng(), png);
    expect(up.status).toBe(403);
    expect((await otherApi.delete(`/api/projects/${project.id}/logo`)).status).toBe(403);
    expect(putObject).not.toHaveBeenCalled();
  });

  it('rejects a request without a file (400)', async () => {
    const { project, ownerApi } = await scenario();
    expect((await ownerApi.post(`/api/projects/${project.id}/logo`)).status).toBe(400);
  });

  it('rejects a file that is not an image, whatever it claims to be (400)', async () => {
    const { project, ownerApi } = await scenario();
    const res = await ownerApi
      .post(`/api/projects/${project.id}/logo`)
      .attach('logo', Buffer.from('not an image at all'), png);
    expect(res.status).toBe(400);
    expect(putObject).not.toHaveBeenCalled();
  });

  it('rejects SVG (400)', async () => {
    const { project, ownerApi } = await scenario();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const res = await ownerApi
      .post(`/api/projects/${project.id}/logo`)
      .attach('logo', svg, { filename: 'l.svg', contentType: 'image/svg+xml' });
    expect(res.status).toBe(400);
    expect(putObject).not.toHaveBeenCalled();
  });

  it('rejects a file over 2 MB (413)', async () => {
    const { project, ownerApi } = await scenario();
    const big = Buffer.alloc(2 * 1024 * 1024 + 1024, 1);
    const res = await ownerApi.post(`/api/projects/${project.id}/logo`).attach('logo', big, png);
    expect(res.status).toBe(413);
    expect(putObject).not.toHaveBeenCalled();
  });

  it('the owner can upload: a 256x256 WebP under a server-chosen key', async () => {
    const { project, ownerApi } = await scenario();
    const res = await ownerApi.post(`/api/projects/${project.id}/logo`).attach('logo', await makePng(600, 600), png);
    expect(res.status).toBe(200);

    const stored = await prisma.project.findUnique({ where: { id: project.id } });
    expect(stored?.logoKey).toMatch(new RegExp(`^logos/${project.id}/[0-9a-f-]{36}\\.webp$`));
    expect(res.body.logoUrl).toBe(`http://media.test/${stored?.logoKey}`);

    const [key, body, type] = vi.mocked(putObject).mock.calls[0];
    expect(key).toBe(stored?.logoKey);
    expect(type).toBe('image/webp');
    const meta = await sharp(body).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(256);
  });

  it('a wide logo is fitted, not cropped: the square has transparent bars', async () => {
    const { project, ownerApi } = await scenario();
    await ownerApi.post(`/api/projects/${project.id}/logo`).attach('logo', await makePng(600, 200), png).expect(200);

    const body = vi.mocked(putObject).mock.calls[0][1];
    const meta = await sharp(body).metadata();
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(256);
    expect(meta.hasAlpha).toBe(true);
    // top-left corner is empty (transparent bar), the middle is the logo colour
    const { data, info } = await sharp(body).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3];
    expect(alphaAt(2, 2)).toBe(0);
    expect(alphaAt(128, 128)).toBe(255);
  });

  it('replacing the logo deletes the old object', async () => {
    const { project, ownerApi } = await scenario();
    await ownerApi.post(`/api/projects/${project.id}/logo`).attach('logo', await makePng(), png).expect(200);
    await ownerApi.post(`/api/projects/${project.id}/logo`).attach('logo', await makePng(), png).expect(200);

    const first = vi.mocked(putObject).mock.calls[0][0];
    const second = vi.mocked(putObject).mock.calls[1][0];
    expect(first).not.toBe(second);
    expect(deleteObject).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledWith(first);
    expect((await prisma.project.findUnique({ where: { id: project.id } }))?.logoKey).toBe(second);
  });

  it('removing clears the logo, deletes the object, and is repeatable', async () => {
    const { project, ownerApi } = await scenario();
    await ownerApi.post(`/api/projects/${project.id}/logo`).attach('logo', await makePng(), png).expect(200);
    const key = vi.mocked(putObject).mock.calls[0][0];

    const res = await ownerApi.delete(`/api/projects/${project.id}/logo`);
    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toBeNull();
    expect(deleteObject).toHaveBeenCalledWith(key);
    expect((await prisma.project.findUnique({ where: { id: project.id } }))?.logoKey).toBeNull();

    await ownerApi.delete(`/api/projects/${project.id}/logo`).expect(200);
    expect(deleteObject).toHaveBeenCalledTimes(1);
  });

  it('project payloads carry logoUrl and never the storage key', async () => {
    const { project, ownerApi } = await scenario();
    const before = await anon().get(`/api/projects/${project.slug}`);
    expect(before.body.logoUrl).toBeNull();
    expect(before.body).not.toHaveProperty('logoKey');

    await prisma.project.update({ where: { id: project.id }, data: { logoKey: 'logos/a/b.webp' } });
    const url = 'http://media.test/logos/a/b.webp';

    const page = await anon().get(`/api/projects/${project.slug}`);
    expect(page.body.logoUrl).toBe(url);
    expect(page.body).not.toHaveProperty('logoKey');

    const browse = await anon().get('/api/projects');
    expect(browse.body[0].logoUrl).toBe(url);
    expect(browse.body[0]).not.toHaveProperty('logoKey');

    const mine = await ownerApi.get('/api/projects/mine');
    expect(mine.body[0].logoUrl).toBe(url);
    expect(mine.body[0]).not.toHaveProperty('logoKey');

    const edited = await ownerApi.patch(`/api/projects/${project.id}`).send({ name: 'Renamed' });
    expect(edited.body.logoUrl).toBe(url);
    expect(edited.body).not.toHaveProperty('logoKey');
  });

  it('the feed and the owner profile carry the project logoUrl', async () => {
    const { owner, project } = await scenario();
    await prisma.project.update({ where: { id: project.id }, data: { logoKey: 'logos/x/y.webp' } });
    await prisma.post.create({
      data: { projectId: project.id, type: 'ANNOUNCEMENT', title: 'Hello', body: 'x' },
    });

    const feed = await anon().get('/api/feed');
    expect(feed.body[0].project).toEqual({
      slug: project.slug,
      name: 'My Game',
      logoUrl: 'http://media.test/logos/x/y.webp',
    });

    const profile = await anon().get(`/api/users/${owner.id}`);
    expect(profile.body.projects[0].logoUrl).toBe('http://media.test/logos/x/y.webp');
    expect(profile.body.projects[0]).not.toHaveProperty('logoKey');
  });

  it('unknown project is 404 and a non-UUID id is 400', async () => {
    const { ownerApi } = await scenario();
    const up = await ownerApi.post(`/api/projects/${randomUUID()}/logo`).attach('logo', await makePng(), png);
    expect(up.status).toBe(404);
    expect((await ownerApi.delete(`/api/projects/${randomUUID()}/logo`)).status).toBe(404);
    const bad = await ownerApi.post('/api/projects/not-a-uuid/logo').attach('logo', await makePng(), png);
    expect(bad.status).toBe(400);
  });
});
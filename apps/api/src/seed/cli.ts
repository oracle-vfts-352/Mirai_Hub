import { storageConfig } from '../lib/config'; // importing config also loads .env
import { prisma } from '../lib/prisma';
import { cleanDemo, seedDemo } from './demo';
import { DEMO_DOMAIN, DEMO_LOGIN_EMAIL } from './demoData';

const KNOWN_FLAGS = ['--clean', '--no-images', '--allow-production', '--force'];
const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);

function stop(message: string): never {
  console.error(`Seed stopped: ${message}`);
  process.exit(1);
}

const unknown = args.filter((a) => !KNOWN_FLAGS.includes(a));
if (unknown.length > 0) {
  stop(`unknown option(s): ${unknown.join(' ')}. Known: ${KNOWN_FLAGS.join(' ')}`);
}

const isProduction = process.env.NODE_ENV === 'production';
if (isProduction && !has('--allow-production')) {
  stop('NODE_ENV is "production". Add --allow-production if you really want demo data in this environment.');
}

// Shows WHERE the data will go (never any credentials)
function describeTargets() {
  const raw = process.env.DATABASE_URL;
  if (!raw) stop('DATABASE_URL is not set.');
  let database: string;
  try {
    const u = new URL(raw);
    database = `${u.hostname}:${u.port || '5432'}/${u.pathname.replace(/^\//, '')}`;
  } catch {
    stop('DATABASE_URL is not a valid URL.');
  }
  let storage = 'not configured (images are skipped)';
  let storageOk = false;
  try {
    const c = storageConfig();
    storage = `${new URL(c.endpoint).host}, bucket ${c.bucket}`;
    storageOk = true;
  } catch {
    // leave the defaults
  }
  return { database, storage, storageOk };
}

async function main() {
  const { database, storage, storageOk } = describeTargets();
  console.log(`Environment : ${process.env.NODE_ENV ?? 'development'}`);
  console.log(`Database    : ${database}`);
  console.log(`Storage     : ${storage}`);
  console.log(`Mail        : none (the seed never sends mail; demo addresses end in ${DEMO_DOMAIN})`);
  console.log('');

  if (has('--clean')) {
    await cleanDemo({ force: has('--force'), log: console.log });
    return;
  }

  const images = !has('--no-images') && process.env.SEED_IMAGES !== 'off' && storageOk;
  const { created, imagesEnabled } = await seedDemo({ images, log: console.log });

  console.log('');
  console.log(
    `Done. Created now: ${created.users} user(s), ${created.projects} project(s), ${created.posts} post(s), ` +
      `${created.feedback} feedback item(s), ${created.images} image(s). (Nothing is created twice: run it again any time.)`,
  );
  if (!images) console.log('Images were skipped (storage not configured, --no-images or SEED_IMAGES=off).');
  else if (!imagesEnabled) console.log('Images were switched off after an error: see the message above.');
  console.log('Keep the worker running: notifications for the demo events are created by it.');
  if (process.env.ENABLE_DEV_LOGIN === 'true' && !isProduction) {
    console.log('');
    console.log(`Sign in as a demo user: open the app, press F12, paste this in the Console, press Enter:`);
    console.log(
      `fetch('/api/dev/login',{method:'POST',headers:{'Content-Type':'application/json'},` +
        `body:JSON.stringify({email:'${DEMO_LOGIN_EMAIL}'})}).then(()=>location.reload())`,
    );
  }
}

let exitCode = 0;
main()
  .catch((err) => {
    console.error(`Seed failed: ${err instanceof Error ? err.message : err}`);
    exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(exitCode);
  });
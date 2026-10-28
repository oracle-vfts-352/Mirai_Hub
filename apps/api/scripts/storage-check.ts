import { ensureBucket, putObject, deleteObject, publicUrl } from '../src/lib/storage';

async function main() {
  await ensureBucket();
  console.log('bucket ready');

  const key = `healthcheck/${Date.now()}.txt`;
  await putObject(key, Buffer.from('hello mirai'), 'text/plain');
  console.log('uploaded', key);

  const res = await fetch(publicUrl(key)); // anonymous, like a browser
  console.log('public GET:', res.status, JSON.stringify(await res.text()));

  await deleteObject(key);
  const after = await fetch(publicUrl(key));
  console.log('after delete:', after.status);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
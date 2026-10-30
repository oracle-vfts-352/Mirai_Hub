import { sendMail } from '../src/lib/mail';

async function main() {
  await sendMail({
    to: 'test@example.com',
    subject: 'Mirai Hub mail check',
    text: 'If you can read this in Mailpit, SMTP works.',
  });
  console.log('Mail sent: open http://localhost:8025');
}

main().catch((err) => {
  console.error('Mail check failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
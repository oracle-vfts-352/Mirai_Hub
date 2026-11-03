import type { authTexts as en } from '../en/auth';

export const authTexts: typeof en = {
  login: {
    title: 'ログイン',
    passkeyButton: 'パスキーでログイン',
    waiting: 'パスキーの確認を待っています...',
    lostLink: 'パスキーをなくした場合は、メールのリンクでログイン',
    emailHelp:
      'パスキーをなくした、または新しい端末ですか？ ログイン用のリンクをメールでお送りします（メールアドレスが確認済みのアカウントのみ）。',
    emailPlaceholder: 'メールアドレス',
    sending: '送信中...',
    sendLink: 'ログインリンクをメールで受け取る',
    sentTo:
      '{{email}} の確認済みアカウントがある場合、ログインリンクを送信しました。リンクは15分間、1回のみ有効です。',
    newHere: 'はじめてですか？',
    signUp: '新規登録',
  },
  signup: {
    title: '新規登録',
    emailPlaceholder: 'メールアドレス',
    namePlaceholder: '名前',
    roleDev: 'プロジェクトを作る（開発者・企業）',
    roleConsumer: 'フィードバックを送る（一般ユーザー）',
    continue: '続ける',
    working: '処理中...',
    haveAccount: 'すでにパスキーをお持ちですか？',
    signIn: 'ログイン',
    accountCreated: 'アカウントを作成しました。最後にパスキーを作成してください。',
    createPasskey: 'パスキーを作成',
    waiting: 'パスキーの確認を待っています...',
  },
  verifyEmail: {
    working: 'メールアドレスを確認しています...',
    done: 'メールアドレスを確認しました。ありがとうございます！',
    goHome: 'Mirai Hub へ',
    incomplete: 'このリンクは不完全です。',
    resendHint: 'ログインして、ホームの「確認メールを再送」から新しいリンクを取得してください。',
  },
  emailLogin: {
    signingIn: 'ログインしています...',
    incomplete: 'このリンクは不完全です。',
    requestNew: 'ログイン画面で新しいリンクを請求してください。',
    goLogin: 'ログイン画面へ',
  },
  banner: {
    text: 'プロジェクトのフォロー、投票、フィードバックにはメールアドレスの確認が必要です。{{email}} に確認リンクを送信しました。',
    resend: '確認メールを再送',
    sending: '送信中...',
    sent: '確認メールを送信しました。受信トレイ（迷惑メールフォルダも）をご確認ください。',
  },
};
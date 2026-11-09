import type { profileTexts as en } from '../en/profile';

export const profileTexts: typeof en = {
  profile: {
    notFound: 'ユーザーが見つかりません。',
    roleDev: '開発者',
    roleConsumer: '一般ユーザー',
    joined: '{{date}} に登録',
    you: 'あなた',
    editProfile: 'プロフィールを編集',
    noBioMine: '自己紹介はまだ書かれていません。',
    noBio: '自己紹介はまだありません。',
    projects: 'プロジェクト',
    noProjects: 'まだプロジェクトがありません。',
    avatar: {
      add: '写真を追加',
      change: '写真を変更',
      remove: '削除',
      working: '処理中...',
      badType: 'PNG、JPEG、WebP の画像を使用してください。',
      tooLarge: '画像が大きすぎます（最大2MB）。',
    },
    passkeys: {
      title: 'パスキー',
      help: 'メールのリンクで新しい端末にログインしましたか？ ここでパスキーを追加すると、次回からこの端末でログインできます。',
      added: 'パスキーを追加しました。',
      alreadyHere: 'この端末には、すでにこのアカウントのパスキーがあります。',
      add: 'この端末にパスキーを追加',
      waiting: 'パスキーの確認を待っています...',
    },
    sessions: {
      title: 'セッション',
      help: '信頼できない場所でログインしたままの場合や、端末をなくした場合は、すべての端末からログアウトして、ここで再ログインしてください。',
      button: 'すべての端末からログアウト',
      working: '処理中...',
      confirm: 'この端末を含め、すべての端末からログアウトしますか？',
    },
    form: {
      name: '名前',
      bio: '自己紹介',
      save: '保存',
      saving: '保存中...',
      cancel: 'キャンセル',
    },
  },
};
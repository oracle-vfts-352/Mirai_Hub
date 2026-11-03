import type { shared as enShared } from '../en/shared';

// Typed as the English version: a missing or extra key is a compile error.
export const shared: typeof enShared = {
  common: {
    loading: '読み込み中...',
    backHome: 'ホームに戻る',
  },
  header: {
    profileTitle: 'プロフィール',
  },
  language: {
    label: '言語',
  },
  notFound: {
    text: 'ページが見つかりません。',
    home: 'ホーム',
  },
  auth: {
    requireDev: 'プロジェクトを作成できるのは開発者アカウントのみです。',
    requireConsumer: 'このページは一般ユーザーのアカウント専用です。',
  },
  status: {
    OPEN: '受付中',
    UNDER_REVIEW: '検討中',
    PLANNED: '対応予定',
    IN_PROGRESS: '対応中',
    SHIPPED: 'リリース済み',
    DECLINED: '見送り',
  },
  postType: {
    VISION: 'ビジョン',
    ANNOUNCEMENT: 'お知らせ',
    CHANGELOG: '更新履歴',
  },
  errors: {
    generic: '問題が発生しました。',
    requestFailed: 'リクエストに失敗しました。',
    uploadFailed: 'アップロードに失敗しました。',
    fileTooLarge: 'ファイルが大きすぎます。',
    passkeyCancelled: 'パスキーの操作がキャンセルされたか、時間切れになりました。',
  },
};
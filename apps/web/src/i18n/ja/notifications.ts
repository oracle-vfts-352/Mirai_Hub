import type { notificationTexts as en } from '../en/notifications';

export const notificationTexts: typeof en = {
  notifications: {
    title: '通知',
    aria: '通知',
    ariaUnread_one: '通知、未読 {{count}} 件',
    ariaUnread_other: '通知、未読 {{count}} 件',
    markAll: 'すべて既読にする',
    empty: 'まだ通知はありません。',
    updateIn: '{{project}} の更新',
    statusNow: '「{{title}}」のステータスが「{{status}}」になりました',
    updated: '「{{title}}」が更新されました',
    replied: '{{project}} が「{{title}}」に返信しました',
    newFeedback: '{{project}} に新しいフィードバック: 「{{title}}」',
    newPost: '新しい投稿: {{title}}',
  },
};
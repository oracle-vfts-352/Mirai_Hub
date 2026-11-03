import i18n from './index';

const locale = () => (i18n.resolvedLanguage === 'ja' ? 'ja-JP' : 'en-US');

export const formatDate = (value: string | number | Date) =>
  new Date(value).toLocaleDateString(locale());

export const formatDateTime = (value: string | number | Date) =>
  new Date(value).toLocaleString(locale());
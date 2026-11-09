import type { FeedbackStatus, PostType } from '@prisma/client';

// Demo accounts all end in this reserved domain: it can never receive mail, and "clean" only ever
// touches accounts with this ending.
export const DEMO_DOMAIN = '@demo.test';
export const DEMO_LOGIN_EMAIL = 'yuki@demo.test';

export type DemoUser = { key: string; email: string; name: string; role: 'DEV' | 'CONSUMER'; bio: string };
export type DemoPost = { type: PostType; title: string; body: string; cover?: boolean };
export type DemoFeedback = {
  by: string; // user key
  title: string;
  body: string;
  aboutPost?: string; // title of a post of the same project
  votes: string[]; // user keys (never the project owner)
  status?: FeedbackStatus;
  reply?: string;
};
export type DemoProject = {
  slug: string;
  owner: string; // user key
  name: string;
  tagline: string;
  vision: string;
  followers: string[];
  posts: DemoPost[];
  feedback: DemoFeedback[];
};

export const DEMO_USERS: DemoUser[] = [
  { key: 'aiko', email: 'aiko@demo.test', name: 'Aiko Tanaka', role: 'DEV', bio: 'Indie game developer. I make small, calm puzzle games.' },
  { key: 'haruto', email: 'haruto@demo.test', name: 'Haruto Mori', role: 'DEV', bio: '個人開発者。静かで使いやすいアプリを作っています。' },
  { key: 'yuki', email: DEMO_LOGIN_EMAIL, name: 'Yuki Sato', role: 'CONSUMER', bio: 'パズルゲームとノートアプリが好きです。' },
  { key: 'sam', email: 'sam@demo.test', name: 'Sam Rivera', role: 'CONSUMER', bio: 'Plays everything with a controller.' },
  { key: 'hana', email: 'hana@demo.test', name: 'Hana Kimura', role: 'CONSUMER', bio: 'いろいろなアプリを試すのが好きです。' },
  { key: 'leo', email: 'leo@demo.test', name: 'Leo Dubois', role: 'CONSUMER', bio: 'Dark mode enthusiast.' },
];

export const DEMO_PROJECTS: DemoProject[] = [
  {
    slug: 'lantern-quest',
    owner: 'aiko',
    name: 'Lantern Quest',
    tagline: 'A cozy puzzle adventure about carrying light through a sleeping city.',
    vision:
      'Lantern Quest is a cozy puzzle adventure. You carry a small lantern through a city that fell asleep, and every light you rekindle wakes a little more of it.\n\nWe want it to be calm, readable and kind: no timers, no punishment, just clever little puzzles and a lot of atmosphere.',
    followers: ['yuki', 'sam', 'hana', 'leo'],
    posts: [
      {
        type: 'VISION',
        title: 'Why we are building Lantern Quest',
        body: 'We love games that let you breathe. Lantern Quest is built around three ideas: light is the only tool, every puzzle has a gentle hint, and the city rewards curiosity. Tell us what would make it better on this page.',
      },
      {
        type: 'ANNOUNCEMENT',
        title: 'Closed beta opens next month',
        body: 'The closed beta starts next month with the first three districts. Follow the project to get a notification when the sign-up page goes live, and use the feedback board below to tell us what matters most.',
        cover: true,
      },
      {
        type: 'CHANGELOG',
        title: 'v0.4: lantern mechanics',
        body: 'New in v0.4:\n- Lanterns can now be handed to friendly characters\n- Reworked light radius so puzzles read more clearly\n- Fixed a bug where the third district gate stayed closed\n- Smaller memory use on older laptops',
      },
    ],
    feedback: [
      {
        by: 'yuki',
        title: 'Add a colorblind-friendly mode',
        body: 'Some of the light puzzles rely on telling red and green lanterns apart. A colorblind-friendly palette or symbols on the lanterns would help a lot.',
        aboutPost: 'v0.4: lantern mechanics',
        votes: ['sam', 'hana', 'leo'],
        status: 'PLANNED',
        reply: 'Thank you, this is an important one. We are planning a symbol overlay for lanterns in v0.5.',
      },
      {
        by: 'sam',
        title: 'Controller support on PC',
        body: 'The game feels made for a controller. Full gamepad support, including menus, would be great.',
        votes: ['yuki', 'hana'],
        status: 'IN_PROGRESS',
      },
      {
        by: 'hana',
        title: 'Option to skip the long intro cutscene',
        body: 'The intro is lovely the first time, but I would like to skip it when I restart.',
        votes: ['leo'],
      },
      {
        by: 'leo',
        title: 'Dark mode for the menu',
        body: 'The menu is very bright next to the game. A dark theme would be easier on the eyes at night.',
        aboutPost: 'v0.4: lantern mechanics',
        votes: ['yuki', 'sam'],
        status: 'SHIPPED',
        reply: 'Shipped in v0.4. Thanks for the suggestion!',
      },
      {
        by: 'sam',
        title: 'Cloud saves between devices',
        body: 'I play on a desktop and a laptop. Syncing saves between them would be fantastic.',
        votes: ['yuki', 'hana', 'leo'],
        status: 'UNDER_REVIEW',
      },
    ],
  },
  {
    slug: 'tsumugi-notes',
    owner: 'haruto',
    name: 'つむぎノート',
    tagline: 'ゆっくり考えを紡ぐ、静かなノートアプリ。',
    vision:
      'つむぎノートは、通知もタイマーもない、静かなノートアプリです。\n\n思いついたことをそっと書きとめて、あとから少しずつ育てていく。そんな使い方を大切にしています。',
    followers: ['yuki', 'hana'],
    posts: [
      {
        type: 'VISION',
        title: 'つむぎノートが目指すもの',
        body: '急がせないこと、散らかさないこと、そして書くことを楽しくすること。この3つを大切にしています。ご意見はこのページのフィードバック欄からお寄せください。',
      },
      {
        type: 'ANNOUNCEMENT',
        title: 'ベータ版を公開しました',
        body: 'つむぎノートのベータ版を公開しました。まずはデスクトップ版からです。使ってみて気づいたことを、ぜひフィードバックで教えてください。',
        cover: true,
      },
      {
        type: 'CHANGELOG',
        title: 'v0.2 の更新内容',
        body: 'v0.2 の更新内容:\n- ノートにタグを付けられるようになりました\n- 起動速度を改善しました\n- 日本語入力中の文字化けを修正しました',
      },
    ],
    feedback: [
      {
        by: 'yuki',
        title: 'タグでノートを整理したい',
        body: 'ノートが増えてきたので、タグで絞り込めると便利です。',
        aboutPost: 'v0.2 の更新内容',
        votes: ['hana', 'sam'],
        status: 'SHIPPED',
        reply: 'v0.2 でタグ機能を追加しました。ありがとうございます！',
      },
      {
        by: 'hana',
        title: 'Markdown に対応してほしい',
        body: '見出しや箇条書きをキーボードだけで書けるとうれしいです。',
        votes: ['yuki'],
        status: 'PLANNED',
        reply: '検討を進めています。次のバージョンで試験的に導入する予定です。',
      },
      {
        by: 'sam',
        title: 'スマートフォン版はありますか？',
        body: '外出先でもメモを取りたいので、スマートフォン版があると助かります。',
        votes: ['yuki', 'hana'],
        status: 'UNDER_REVIEW',
      },
    ],
  },
];
// Root keys: login, signup, verifyEmail, emailLogin, banner (NOT "auth": shared.ts already has that).
export const authTexts = {
  login: {
    title: 'Sign in',
    passkeyButton: 'Sign in with passkey',
    waiting: 'Waiting for your passkey prompt...',
    lostLink: 'Lost your passkey? Sign in with an email link',
    emailHelp:
      'Lost your passkey or on a new device? We can email you a sign-in link (only for accounts with a verified email).',
    emailPlaceholder: 'Your email',
    sending: 'Sending...',
    sendLink: 'Email me a sign-in link',
    sentTo:
      'If a verified account exists for {{email}}, we sent a sign-in link. It works once and for 15 minutes.',
    newHere: 'New here?',
    signUp: 'Sign up',
  },
  signup: {
    title: 'Sign up',
    emailPlaceholder: 'Email',
    namePlaceholder: 'Name',
    roleDev: 'I build projects (dev / company)',
    roleConsumer: 'I give feedback (consumer)',
    continue: 'Continue',
    working: 'Working...',
    haveAccount: 'Already have a passkey?',
    signIn: 'Sign in',
    accountCreated: 'Account created. Now create a passkey to finish.',
    createPasskey: 'Create passkey',
    waiting: 'Waiting for your passkey prompt...',
  },
  verifyEmail: {
    working: 'Verifying your email...',
    done: 'Your email is verified. Thank you!',
    goHome: 'Go to Mirai Hub',
    incomplete: 'This link is incomplete.',
    resendHint: 'Sign in and use "Resend email" on the home page to get a new link.',
  },
  emailLogin: {
    signingIn: 'Signing you in...',
    incomplete: 'This link is incomplete.',
    requestNew: 'Request a new link on the sign-in page.',
    goLogin: 'Go to sign in',
  },
  banner: {
    text: 'Please verify your email address to follow projects, vote and give feedback. We sent a link to {{email}}.',
    resend: 'Resend email',
    sending: 'Sending...',
    sent: 'Email sent. Check your inbox (and your spam folder).',
  },
};
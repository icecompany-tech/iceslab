export const login = {
  login: {
    bootstrapTitle: '{{brand}} - create first admin',
    signInTitle: '{{brand}} - sign in',
    bootstrapHint:
      'No admins exist yet. The first registration creates the bootstrap account.',
    username: 'Username',
    password: 'Password',
    submitLogin: 'Sign in',
    submitRegister: 'Create admin',
  },

  loginPage: {
    // {{version}} injected at runtime from package.json via vite-define.
    topbarVersion: 'v{{version}} · Operator panel · Alpha',
    topbarStatusNormal: 'Backend reachable',
    topbarStatusDegraded: 'Backend degraded',
    topbarStatusDown: 'Backend unreachable',
    signInBadge: 'Sign in',
    heroLine1: 'Operator',
    heroLine2: 'console.',
    heroDescription: 'One panel. Every protocol. Native cores. mTLS agents.',
    feature1: 'Multi-protocol',
    feature2: 'Native binaries',
    feature3: 'mTLS push',
    footerLicense: 'AGPL-3.0',
    footerHosting: 'Self-hosted',
    credentialsLabel: 'Credentials',
    signInTo: 'Sign in to {{brand}}',
    bootstrapTo: 'Bootstrap {{brand}}',
    // No arrow glyph in the copy: the button draws its own.
    continueAction: 'Continue',
    createAdminAction: 'Create admin',
    bootstrapHint: 'First admin has full panel access. Choose a strong password, bootstrap runs once.',
    signInFailed: 'Sign-in failed',
    unknownError: 'Unknown error',
    twofaCodeLabel: 'Two-factor code',
    twofaHint: 'Two-factor is on for this admin, the code is asked after the password.',
    twofaVerify: 'Verify',
    twofaTitle: 'Two-factor',
    twofaInvalid: 'Invalid code, try again',
  },
} as const;

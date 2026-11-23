import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { mock } from 'node:test'
import { buildSubscriptionPage } from '../src/modules/subscription/subscription.page.js'

const out = process.argv[2]
if (!out) throw Error('Usage: tsx scripts/render-paper-subscriptions.ts OUTPUT')
mkdirSync(resolve(out), { recursive: true })
mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-05T12:00:00Z') })
try {
  for (const state of ['active', 'expiring', 'expired', 'limited', 'disabled', 'revoked'] as const) {
    const status = state === 'expiring' ? 'active' : state
    const expiresAt = state === 'expiring' ? '2026-11-08T12:00:00Z' : '2027-01-26T12:00:00Z'
    for (const lang of ['ru', 'en'] as const) {
      const html = buildSubscriptionPage({
        brandTitle: 'Iceslab', lang, subUrl: 'https://sub.example.com/s/7b16e72f474ffe9d', supportUrl: 'https://support.example.invalid',
        user: {
          username: 'alex-hm', status,
          expireAt: status === 'expired' ? '2026-10-31T12:00:00Z' : expiresAt,
          trafficLimitBytes: 200 * 1024 ** 3, trafficUsedBytes: (status === 'limited' ? 200 : 118) * 1024 ** 3,
        },
        protocols: status === 'active' ? ['xray', 'hysteria'] : [],
      })
      writeFileSync(join(out, state + '-' + lang + '.html'), html)
    }
  }
} finally {
  mock.timers.reset()
}

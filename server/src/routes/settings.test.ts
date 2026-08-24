import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app.js'
import { hashPassword } from '../security/password.js'
import { MemoryLifeStore } from '../store/memoryLifeStore.js'

const config = {
  cookieName: 'lifeops_session',
  sessionTtlSeconds: 3600,
  secureCookies: false,
  allowedOrigins: ['http://localhost'],
  logger: false,
  trustProxy: false as const,
}

function cookieOf(response: { headers: Record<string, unknown> }) {
  return String(response.headers['set-cookie']).split(';')[0]
}

describe('settings, account and safe data routes', () => {
  let app: FastifyInstance
  let store: MemoryLifeStore

  beforeEach(async () => {
    store = new MemoryLifeStore({ now: () => '2026-08-23T02:30:00.000Z' })
    await store.createUser({
      account: 'owner@example.com',
      displayName: 'LifeOps Owner',
      passwordHash: await hashPassword('Correct-password-2026!'),
    })
    app = buildApp({ store, config })
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  async function login(password = 'Correct-password-2026!') {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { account: 'owner@example.com', password } })
    return { response, cookie: cookieOf(response), csrf: response.json().csrfToken as string }
  }

  it('updates preferences and returns a versioned server-owned settings document', async () => {
    const { cookie, csrf } = await login()
    const initial = await app.inject({ method: 'GET', url: '/api/v1/settings', headers: { cookie } })
    expect(initial.statusCode).toBe(200)
    expect(initial.json()).toMatchObject({ version: 1, appearance: { theme: 'system', motion: 'system' }, locale: { locale: 'zh-CN' } })

    const saved = await app.inject({
      method: 'PATCH', url: '/api/v1/settings', headers: { cookie, 'x-csrf-token': csrf },
      payload: { appearance: { theme: 'dark', motion: 'reduce' }, locale: { locale: 'zh-CN', timezone: 'Asia/Shanghai', weekStartsOn: 1 }, version: 1 },
    })
    expect(saved.statusCode).toBe(200)
    expect(saved.json()).toMatchObject({ version: 2, appearance: { theme: 'dark', motion: 'reduce' }, locale: { timezone: 'Asia/Shanghai' } })
  })

  it('lists active sessions without token material, revokes another session and refuses current-session revoke without explicit logout', async () => {
    const first = await login()
    const second = await login()
    const listed = await app.inject({ method: 'GET', url: '/api/v1/account/sessions', headers: { cookie: first.cookie } })
    expect(listed.statusCode).toBe(200)
    const sessions = listed.json().sessions as Array<{ id: string; current: boolean }>
    expect(sessions).toHaveLength(2)
    expect(JSON.stringify(listed.json())).not.toMatch(/tokenHash|csrfToken|lifeops_session/)

    const other = sessions.find((session) => !session.current)!
    const revoked = await app.inject({ method: 'POST', url: `/api/v1/account/sessions/${other.id}/revoke`, headers: { cookie: first.cookie, 'x-csrf-token': first.csrf }, payload: {} })
    expect(revoked.statusCode).toBe(204)
    const otherSession = await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: second.cookie } })
    expect(otherSession.statusCode).toBe(401)

    const current = sessions.find((session) => session.current)!
    const refused = await app.inject({ method: 'POST', url: `/api/v1/account/sessions/${current.id}/revoke`, headers: { cookie: first.cookie, 'x-csrf-token': first.csrf }, payload: {} })
    expect(refused.statusCode).toBe(409)
    expect(refused.json().error.code).toBe('CURRENT_SESSION_REQUIRES_LOGOUT')
  })

  it('verifies the current password, enforces the new policy, rotates the password and revokes other sessions', async () => {
    const first = await login()
    await login()
    const wrong = await app.inject({
      method: 'POST', url: '/api/v1/account/password', headers: { cookie: first.cookie, 'x-csrf-token': first.csrf },
      payload: { currentPassword: 'Wrong-password-2026!', newPassword: 'New-correct-password-2026!' },
    })
    expect(wrong.statusCode).toBe(403)
    expect(wrong.json().error.code).toBe('CURRENT_PASSWORD_INVALID')

    const weak = await app.inject({
      method: 'POST', url: '/api/v1/account/password', headers: { cookie: first.cookie, 'x-csrf-token': first.csrf },
      payload: { currentPassword: 'Correct-password-2026!', newPassword: 'twelvechars!' },
    })
    expect(weak.statusCode).toBe(400)
    expect(weak.json().error.code).toBe('PASSWORD_POLICY')

    const changed = await app.inject({
      method: 'POST', url: '/api/v1/account/password', headers: { cookie: first.cookie, 'x-csrf-token': first.csrf },
      payload: { currentPassword: 'Correct-password-2026!', newPassword: 'New-correct-password-2026!' },
    })
    expect(changed.statusCode).toBe(204)
    expect((await login()).response.statusCode).toBe(401)
    expect((await login('New-correct-password-2026!')).response.statusCode).toBe(200)
  })

  it('exports original, Life, trash and settings data without security internals and keeps preview no-write', async () => {
    const auth = await login()
    const exported = await app.inject({ method: 'POST', url: '/api/v1/data/export', headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrf }, payload: {} })
    expect(exported.statusCode).toBe(200)
    expect(exported.json()).toMatchObject({ schemaVersion: 1, checksumSha256: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(exported.json().canonicalJson).toContain('"original"')
    expect(exported.json().canonicalJson).toContain('"life"')
    expect(exported.json().canonicalJson).toContain('"settings"')
    expect(exported.json().canonicalJson).not.toMatch(/passwordHash|tokenHash|csrfToken|loginLimits|platformCredentials|rawSanitizedLogSamples/)

    const before = await app.inject({ method: 'GET', url: '/api/v1/settings', headers: { cookie: auth.cookie } })
    const preview = await app.inject({
      method: 'POST', url: '/api/v1/data/import/preview', headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrf },
      payload: { canonicalJson: exported.json().canonicalJson, checksumSha256: exported.json().checksumSha256 },
    })
    expect(preview.statusCode).toBe(200)
    expect(preview.json()).toMatchObject({ previewChecksum: expect.stringMatching(/^[a-f0-9]{64}$/), rejectedRecords: [] })
    const after = await app.inject({ method: 'GET', url: '/api/v1/settings', headers: { cookie: auth.cookie } })
    expect(after.json()).toEqual(before.json())
  })

  it('requires the exact preview checksum and current password for all-or-nothing apply and writes safe audit metadata', async () => {
    const auth = await login()
    const exported = await app.inject({ method: 'POST', url: '/api/v1/data/export', headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrf }, payload: {} })
    const preview = await app.inject({
      method: 'POST', url: '/api/v1/data/import/preview', headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrf },
      payload: { canonicalJson: exported.json().canonicalJson, checksumSha256: exported.json().checksumSha256 },
    })

    const stale = await app.inject({
      method: 'POST', url: '/api/v1/data/import/apply', headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrf },
      payload: { previewChecksum: '0'.repeat(64), currentPassword: 'Correct-password-2026!' },
    })
    expect(stale.statusCode).toBe(409)
    const wrong = await app.inject({
      method: 'POST', url: '/api/v1/data/import/apply', headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrf },
      payload: { previewChecksum: preview.json().previewChecksum, currentPassword: 'Wrong-password-2026!' },
    })
    expect(wrong.statusCode).toBe(403)
    const applied = await app.inject({
      method: 'POST', url: '/api/v1/data/import/apply', headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrf },
      payload: { previewChecksum: preview.json().previewChecksum, currentPassword: 'Correct-password-2026!' },
    })
    expect(applied.statusCode).toBe(200)
    expect(applied.json().applied).toBe(true)
    expect(applied.json().restorePoint).toMatchObject({
      id: expect.any(String),
      checksumSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      createdAt: expect.any(String),
    })

    const audit = await app.inject({ method: 'GET', url: '/api/v1/audit', headers: { cookie: auth.cookie } })
    expect(audit.statusCode).toBe(200)
    expect(audit.json().events.some((event: { action: string }) => event.action === 'data.import.apply')).toBe(true)
    expect(audit.json().events.find((event: { action: string }) => event.action === 'data.import.apply').metadata)
      .toMatchObject({ restorePointId: applied.json().restorePoint.id })
    expect(JSON.stringify(audit.json())).not.toMatch(/Correct-password|Wrong-password|canonicalJson|tokenHash|csrfToken/)
  })
})

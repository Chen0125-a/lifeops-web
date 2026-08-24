import { describe, expect, it, vi } from 'vitest'
import type { User } from './domain/types.js'
import { ensureBootstrapUser } from './bootstrap.js'
import type { LifeStore } from './store/lifeStore.js'

describe('ensureBootstrapUser', () => {
  it('recovers when another API replica creates the bootstrap account first', async () => {
    const winner: User = {
      id: 'winner',
      account: 'admin',
      displayName: 'Owner',
      passwordHash: 'already-created',
      createdAt: '2026-08-09T00:00:00.000Z',
    }
    const store = {
      findUserByAccount: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(winner),
      createUser: vi.fn().mockRejectedValue(new Error('duplicate entry')),
    } as unknown as LifeStore

    const result = await ensureBootstrapUser(store, {
      account: 'admin',
      password: 'a-strong-bootstrap-password',
      displayName: 'Owner',
    })

    expect(result).toEqual({ created: false, user: winner })
    expect(store.findUserByAccount).toHaveBeenCalledTimes(2)
  })
})

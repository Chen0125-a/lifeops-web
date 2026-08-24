import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'mysql2/promise'
import { MySqlLifeStore } from './mysqlLifeStore.js'

describe('MySqlLifeStore datetime contract', () => {
  it('writes UTC ISO timestamps using MySQL DATETIME syntax', async () => {
    const execute = vi.fn().mockResolvedValue([{ affectedRows: 1 }, []])
    const store = new MySqlLifeStore({ execute } as unknown as Pool, {
      createId: () => 'plan-id',
      now: () => '2026-08-09T03:04:05.678Z',
    })

    await store.createPlan('user-id', { title: '数据库时间契约' })

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO plans'),
      ['plan-id', 'user-id', '数据库时间契约', null, 'planned', '2026-08-09 03:04:05.678', '2026-08-09 03:04:05.678'],
    )
  })
})

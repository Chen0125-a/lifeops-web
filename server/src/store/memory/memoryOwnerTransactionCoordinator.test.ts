import { describe, expect, it } from 'vitest'
import { MemoryOwnerTransactionCoordinator } from './memoryOwnerTransactionCoordinator.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((onResolve) => { resolve = onResolve })
  return { promise, resolve }
}

async function withDeadline<T>(promise: Promise<T>, timeoutMs = 750) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Coordinator operation timed out.')), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

describe('MemoryOwnerTransactionCoordinator', () => {
  it('runs same-owner work in FIFO order', async () => {
    const coordinator = new MemoryOwnerTransactionCoordinator()
    const releaseFirst = deferred()
    const order: string[] = []
    const first = coordinator.runExclusive('owner-a', 'first', async () => {
      order.push('first-start')
      await releaseFirst.promise
      order.push('first-end')
    })
    const second = coordinator.runExclusive('owner-a', 'second', async () => {
      order.push('second')
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(order).toEqual(['first-start'])
    releaseFirst.resolve()
    await Promise.all([first, second])
    expect(order).toEqual(['first-start', 'first-end', 'second'])
  })

  it('continues the same-owner queue after prior work fails', async () => {
    const coordinator = new MemoryOwnerTransactionCoordinator()
    const first = coordinator.runExclusive('owner-a', 'failure', async () => {
      throw new Error('expected failure')
    })
    const second = coordinator.runExclusive('owner-a', 'success', async () => 'continued')
    await expect(first).rejects.toThrow('expected failure')
    await expect(second).resolves.toBe('continued')
  })

  it('allows different owners to progress independently', async () => {
    const coordinator = new MemoryOwnerTransactionCoordinator()
    const releaseFirst = deferred()
    const first = coordinator.runExclusive('owner-a', 'blocked', async () => releaseFirst.promise)
    const second = coordinator.runExclusive('owner-b', 'independent', async () => 'owner-b-complete')
    await expect(withDeadline(second)).resolves.toBe('owner-b-complete')
    releaseFirst.resolve()
    await first
  })

  it('rejects same-owner reentry immediately instead of deadlocking', async () => {
    const coordinator = new MemoryOwnerTransactionCoordinator()
    const reentrant = coordinator.runExclusive('owner-a', 'outer', async () => (
      coordinator.runExclusive('owner-a', 'inner', async () => 'unreachable')
    ))
    await expect(withDeadline(reentrant)).rejects.toMatchObject({
      code: 'MEMORY_OWNER_TRANSACTION_REENTRY',
    })
  })
})

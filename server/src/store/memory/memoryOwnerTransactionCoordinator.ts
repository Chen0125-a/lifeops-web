export interface MemoryOwnerTransactionEvent {
  userId: string
  operation: string
  phase: string
}

export type MemoryOwnerTransactionObserver = (event: MemoryOwnerTransactionEvent) => Promise<void> | void

export interface MemoryOwnerTransactionParticipant<State = unknown> {
  captureOwnerTransactionState(userId: string): State
  restoreOwnerTransactionState(userId: string, state: State): void
}

interface CapturedParticipant {
  participant: MemoryOwnerTransactionParticipant
  state: unknown
}

interface OwnerTransactionContext {
  userId: string
  active: boolean
  parent?: OwnerTransactionContext
}

export class MemoryOwnerTransactionReentryError extends Error {
  readonly code = 'MEMORY_OWNER_TRANSACTION_REENTRY'

  constructor(readonly userId: string) {
    super(`A transaction for owner ${userId} cannot re-enter its own coordinator lock.`)
    this.name = 'MemoryOwnerTransactionReentryError'
  }
}

export class MemoryOwnerTransactionCoordinator {
  private readonly ownerLocks = new Map<string, Promise<void>>()
  private readonly transactionContext = new AsyncLocalStorage<OwnerTransactionContext>()

  constructor(private readonly observer: MemoryOwnerTransactionObserver = () => undefined) {}

  runExclusive<T>(userId: string, _operation: string, work: () => Promise<T>): Promise<T> {
    return this.withOwnerLock(userId, work)
  }

  runAtomic<T>(
    userId: string,
    operation: string,
    participants: MemoryOwnerTransactionParticipant<any>[],
    work: () => Promise<T>,
  ): Promise<T> {
    return this.withOwnerLock(userId, async () => {
      const captured: CapturedParticipant[] = participants.map((participant) => ({
        participant,
        state: participant.captureOwnerTransactionState(userId),
      }))
      try {
        await this.checkpoint(userId, operation, 'snapshot-captured')
        return await work()
      } catch (error) {
        for (const entry of [...captured].reverse()) {
          entry.participant.restoreOwnerTransactionState(userId, entry.state)
        }
        throw error
      }
    })
  }

  runPreparedAtomic<T>(
    userId: string,
    operation: string,
    participants: MemoryOwnerTransactionParticipant<any>[],
    prepare: () => Promise<void>,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.withOwnerLock(userId, async () => {
      await prepare()
      await this.checkpoint(userId, operation, 'restore-point-persisted')
      const captured: CapturedParticipant[] = participants.map((participant) => ({
        participant,
        state: participant.captureOwnerTransactionState(userId),
      }))
      try {
        await this.checkpoint(userId, operation, 'snapshot-captured')
        return await work()
      } catch (error) {
        for (const entry of [...captured].reverse()) {
          entry.participant.restoreOwnerTransactionState(userId, entry.state)
        }
        throw error
      }
    })
  }

  async checkpoint(userId: string, operation: string, phase: string) {
    await this.observer({ userId, operation, phase })
  }

  private async withOwnerLock<T>(userId: string, work: () => Promise<T>): Promise<T> {
    for (let context = this.transactionContext.getStore(); context; context = context.parent) {
      if (context.active && context.userId === userId) throw new MemoryOwnerTransactionReentryError(userId)
    }
    const previous = this.ownerLocks.get(userId) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const queued = previous.then(() => gate)
    this.ownerLocks.set(userId, queued)
    await previous
    const context: OwnerTransactionContext = {
      userId,
      active: true,
      parent: this.transactionContext.getStore(),
    }
    try {
      return await this.transactionContext.run(context, work)
    } finally {
      context.active = false
      release()
      if (this.ownerLocks.get(userId) === queued) this.ownerLocks.delete(userId)
    }
  }
}
import { AsyncLocalStorage } from 'node:async_hooks'

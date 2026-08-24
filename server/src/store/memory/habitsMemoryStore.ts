import { createHash, randomUUID } from 'node:crypto'
import {
  HabitsDomainError,
  assertDateOnly,
  createHabitEntity,
  createHabitEntryEntity,
  normalizeHabitIdempotencyKey,
  updateHabitEntity,
  updateHabitEntryEntity,
  type CreateHabitInput,
  type Habit,
  type HabitEntry,
  type HabitsStore,
  type UpdateHabitInput,
  type UpsertHabitEntryInput,
} from '../../domain/habits.js'

interface Owned<T> {
  userId: string
  value: T
}

interface IdempotentRecord<T> {
  hash: string
  promise: Promise<T>
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function requestHash(value: unknown) {
  return createHash('sha256').update(stableJson(value)).digest('hex').toUpperCase()
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

export class HabitsMemoryStore implements HabitsStore {
  private readonly habits: Array<Owned<Habit>> = []
  private readonly entries: Array<Owned<HabitEntry>> = []
  private readonly idempotency = new Map<string, IdempotentRecord<unknown>>()

  constructor(private readonly options: {
    createId?: () => string
    now?: () => string
    validateLinks?: (userId: string, links: Pick<CreateHabitInput, 'goalId' | 'projectId'>) => Promise<void>
  } = {}) {}

  private createId = () => this.options.createId?.() ?? randomUUID()
  private now = () => this.options.now?.() ?? new Date().toISOString()

  captureOwnerTransactionState(userId: string) {
    return {
      habits: clone(this.habits.filter((entry) => entry.userId === userId)),
      entries: clone(this.entries.filter((entry) => entry.userId === userId)),
      idempotency: [...this.idempotency.entries()].filter(([key]) => key.startsWith(`${userId}\0`)),
    }
  }

  restoreOwnerTransactionState(userId: string, state: ReturnType<HabitsMemoryStore['captureOwnerTransactionState']>) {
    this.replaceOwnerRows(this.habits, userId, state.habits)
    this.replaceOwnerRows(this.entries, userId, state.entries)
    for (const key of [...this.idempotency.keys()]) if (key.startsWith(`${userId}\0`)) this.idempotency.delete(key)
    for (const [key, value] of state.idempotency) this.idempotency.set(key, value)
  }

  replaceOwnerPortableData(userId: string, habits: Habit[], entries: HabitEntry[]) {
    this.replaceOwnerRows(this.habits, userId, habits.map((value) => ({ userId, value: clone(value) })))
    this.replaceOwnerRows(this.entries, userId, entries.map((value) => ({ userId, value: clone(value) })))
    for (const key of [...this.idempotency.keys()]) if (key.startsWith(`${userId}\0`)) this.idempotency.delete(key)
  }

  private replaceOwnerRows<T extends { userId: string }>(target: T[], userId: string, rows: T[]) {
    target.splice(0, target.length, ...target.filter((entry) => entry.userId !== userId), ...clone(rows))
  }

  async listHabits(userId: string) {
    return this.habits
      .filter((record) => record.userId === userId && record.value.deletedAt == null)
      .map((record) => clone(record.value))
      .sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '') || left.id.localeCompare(right.id))
  }

  async getHabit(userId: string, id: string) {
    const habit = this.findHabit(userId, id)?.value
    return habit ? clone(habit) : undefined
  }

  async createHabit(userId: string, input: CreateHabitInput, idempotencyKey: string) {
    const result = await this.createIdempotently(userId, 'habits:create', idempotencyKey, input, async () => {
      await this.options.validateLinks?.(userId, input)
      const habit = createHabitEntity(this.createId(), this.now(), input)
      this.habits.push({ userId, value: habit })
      return habit
    })
    return result.value
  }

  async updateHabit(userId: string, id: string, input: UpdateHabitInput) {
    const owned = this.findHabit(userId, id)
    if (!owned) return undefined
    const next = updateHabitEntity(owned.value, this.now(), input)
    if (input.goalId !== undefined || input.projectId !== undefined) {
      await this.options.validateLinks?.(userId, next)
    }
    owned.value = next
    return clone(next)
  }

  async listHabitEntries(userId: string, from?: string, to?: string) {
    if (from) assertDateOnly(from, '开始日期')
    if (to) assertDateOnly(to, '结束日期')
    if (from && to && from > to) throw new HabitsDomainError('INVALID_INPUT', '结束日期不能早于开始日期', 400)
    const habitIds = new Set(this.habits
      .filter((record) => record.userId === userId && record.value.deletedAt == null)
      .map((record) => record.value.id))
    return this.entries
      .filter((record) => record.userId === userId && record.value.deletedAt == null && habitIds.has(record.value.habitId))
      .filter((record) => (!from || record.value.entryDate >= from) && (!to || record.value.entryDate <= to))
      .map((record) => clone(record.value))
      .sort((left, right) => left.entryDate.localeCompare(right.entryDate) || left.id.localeCompare(right.id))
  }

  async upsertHabitEntry(
    userId: string,
    habitId: string,
    entryDate: string,
    input: UpsertHabitEntryInput,
    idempotencyKey?: string,
  ) {
    assertDateOnly(entryDate, '记录日期')
    if (!this.findHabit(userId, habitId)) return undefined
    const findOwnedEntry = () => this.entries.find((record) => record.userId === userId
      && record.value.habitId === habitId
      && record.value.entryDate === entryDate
      && record.value.deletedAt == null)
    if (input.version !== undefined) {
      const owned = findOwnedEntry()
      if (!owned) return undefined
      const entry = updateHabitEntryEntity(owned.value, this.now(), input)
      owned.value = entry
      return { entry: clone(entry), created: false, replayed: false }
    }
    if (!idempotencyKey) throw new HabitsDomainError('INVALID_INPUT', '创建记录需要幂等键', 400)
    const result = await this.createIdempotently(
      userId,
      `habits:${habitId}:entries:${entryDate}:create`,
      idempotencyKey,
      input,
      async () => {
        if (findOwnedEntry()) {
          throw new HabitsDomainError('VERSION_CONFLICT', '该日期已有记录，请携带版本号修正', 409)
        }
        const entry = createHabitEntryEntity(this.createId(), habitId, entryDate, this.now(), input)
        this.entries.push({ userId, value: entry })
        return entry
      },
    )
    return { entry: result.value, created: true, replayed: result.replayed }
  }

  private findHabit(userId: string, id: string) {
    return this.habits.find((record) => record.userId === userId && record.value.id === id && record.value.deletedAt == null)
  }

  private async createIdempotently<T>(
    userId: string,
    scope: string,
    rawKey: string,
    input: unknown,
    create: () => Promise<T>,
  ): Promise<{ value: T; replayed: boolean }> {
    const key = `${userId}\u0000${scope}\u0000${normalizeHabitIdempotencyKey(rawKey)}`
    const hash = requestHash(input)
    const existing = this.idempotency.get(key) as IdempotentRecord<T> | undefined
    if (existing) {
      if (existing.hash !== hash) throw new HabitsDomainError('IDEMPOTENCY_CONFLICT', '幂等键已用于不同请求', 409)
      return { value: clone(await existing.promise), replayed: true }
    }
    const promise = Promise.resolve().then(create)
    this.idempotency.set(key, { hash, promise })
    try {
      return { value: clone(await promise), replayed: false }
    } catch (error) {
      this.idempotency.delete(key)
      throw error
    }
  }
}

import type { PublishingStore } from '../store/publishingStore.js'

export interface PublicationResult {
  draftId: string
  revisionId: string
  revision: number
}

export async function publishDueDrafts(store: PublishingStore, now: string): Promise<PublicationResult[]> {
  const results: PublicationResult[] = []
  for (const id of await store.listDuePublicDraftIds(now)) {
    const published = await store.publishDuePublicDraft(id, now)
    if (published) results.push(published)
  }
  return results
}

export class PublicationScheduler {
  private readonly now: () => string
  private readonly intervalMs: number
  private readonly onError: (error: unknown) => void
  private timer: NodeJS.Timeout | undefined
  private inFlight: Promise<void> | undefined

  constructor(
    private readonly store: PublishingStore,
    options: { now?: () => string; intervalMs?: number; onError?: (error: unknown) => void } = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.intervalMs = options.intervalMs ?? 60_000
    this.onError = options.onError ?? (() => console.error('[lifeops] scheduled publishing failed'))
  }

  start(): void {
    if (this.timer) return
    void this.tick()
    this.timer = setInterval(() => void this.tick(), this.intervalMs)
    this.timer.unref?.()
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    await this.inFlight
  }

  private async tick() {
    if (this.inFlight) return this.inFlight
    const task = publishDueDrafts(this.store, this.now()).then(() => undefined).catch((error) => {
      this.onError(error)
    }).finally(() => {
      if (this.inFlight === task) this.inFlight = undefined
    })
    this.inFlight = task
    return task
  }
}

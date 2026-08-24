import { createHash } from 'node:crypto'
import type { FastifyInstance, InjectOptions } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../app.js'
import { readStoredZip } from '../domain/life/commerce.js'
import type { MediaStoragePort, PutMediaInput } from '../media/storagePort.js'
import { hashPassword } from '../security/password.js'
import { MemoryLifeStore } from '../store/memoryLifeStore.js'
import type { MemoryOwnerTransactionObserver } from '../store/memory/memoryOwnerTransactionCoordinator.js'

interface Client {
  get(url: string): ReturnType<FastifyInstance['inject']>
  write(options: InjectOptions, idempotencyKey: string): ReturnType<FastifyInstance['inject']>
}

function cookieFrom(headers: Record<string, string | string[] | undefined>) {
  const value = headers['set-cookie']
  return (Array.isArray(value) ? value[0] : value)?.split(';')[0] ?? ''
}

const checksum = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')

class TestMediaStorage implements MediaStoragePort {
  private readonly values = new Map<string, Uint8Array>()
  private sequence = 0

  async put(input: PutMediaInput) {
    const storageKey = `test-${++this.sequence}.png`
    this.values.set(storageKey, new Uint8Array(input.bytes))
    return {
      storageKey,
      mimeType: 'image/png' as const,
      sizeBytes: input.bytes.byteLength,
      checksum: createHash('sha256').update(input.bytes).digest('hex').toUpperCase(),
    }
  }

  async read(storageKey: string) { return this.values.get(storageKey) }
  async remove(storageKey: string) { return this.values.delete(storageKey) }
}

describe('life portability routes', () => {
  let app: FastifyInstance
  let store: MemoryLifeStore
  let mediaStorage: TestMediaStorage
  let transactionObserver: MemoryOwnerTransactionObserver | undefined

  beforeEach(async () => {
    transactionObserver = undefined
    let sequence = 0
    store = new MemoryLifeStore({
      createId: () => `portability-${++sequence}`,
      now: () => '2026-08-14T09:00:00.000Z',
      transactionObserver: (event) => transactionObserver?.(event),
    })
    await store.createUser({
      account: 'owner@example.com',
      displayName: 'Owner',
      passwordHash: await hashPassword('owner-safe-password'),
    })
    mediaStorage = new TestMediaStorage()
    app = buildApp({
      store,
      config: { cookieName: 'lifeops_session', sessionTtlSeconds: 3_600, secureCookies: false },
      mediaStorage,
    })
    await app.ready()
  })

  it('packages referenced attachment bytes and verifiable metadata only when explicitly requested', async () => {
    const owner = await client()
    const user = await store.findUserByAccount('owner@example.com')
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])
    const stored = await mediaStorage.put({ originalName: 'portable.png', mimeType: 'image/png', bytes })
    const asset = await store.createMediaAsset(user!.id, {
      originalName: 'portable.png', mimeType: stored.mimeType, sizeBytes: stored.sizeBytes,
      storageKey: stored.storageKey, checksum: stored.checksum, width: 1, height: 1,
    }, 'portable-media')
    const catalog = await owner.write({
      method: 'POST', url: '/api/v1/life/catalog', payload: {
        kind: 'ingredient', name: 'Attached ingredient', baseUnit: 'gram', availableUnits: ['gram'],
        attachments: [{ mediaId: asset.id, caption: 'Private source photo' }],
      },
    }, 'catalog-with-attachment')
    expect(catalog.statusCode).toBe(201)

    const exported = await owner.write({
      method: 'POST', url: '/api/v1/life/exports',
      payload: { format: 'zip', includeAttachments: true },
    }, 'export-with-attachment')
    expect(exported.statusCode).toBe(201)
    const job = exported.json<{ archiveBase64: string; archiveEntries: string[]; checksumSha256: string; formatVersion: number }>()
    expect(job.archiveEntries).toEqual(['manifest.json', 'lifeops.json', `attachments/${asset.id}.png`])
    const entries = readStoredZip(Buffer.from(job.archiveBase64, 'base64'))
    expect(entries.get(`attachments/${asset.id}.png`)).toEqual(bytes)
    const payload = JSON.parse(entries.get('lifeops.json')!.toString('utf8')) as {
      mediaAssets: Array<{ id: string; checksum: string; archiveEntry: string; sizeBytes: number }>
    }
    expect(payload.mediaAssets).toEqual([expect.objectContaining({
      id: asset.id, checksum: stored.checksum, sizeBytes: bytes.length,
      archiveEntry: `attachments/${asset.id}.png`,
    })])

    let targetSequence = 0
    const targetStore = new MemoryLifeStore({
      createId: () => `portable-target-${++targetSequence}`,
      now: () => '2026-08-14T10:00:00.000Z',
    })
    await targetStore.createUser({
      account: 'target@example.com', displayName: 'Target',
      passwordHash: await hashPassword('target-safe-password'),
    })
    const targetStorage = new TestMediaStorage()
    const targetApp = buildApp({
      store: targetStore,
      config: { cookieName: 'lifeops_target_session', sessionTtlSeconds: 3_600, secureCookies: false },
      mediaStorage: targetStorage,
    })
    await targetApp.ready()
    try {
      const login = await targetApp.inject({
        method: 'POST', url: '/api/v1/auth/login',
        payload: { account: 'target@example.com', password: 'target-safe-password' },
      })
      const cookie = cookieFrom(login.headers)
      const csrf = login.json<{ csrfToken: string }>().csrfToken
      const headers = { cookie, 'x-csrf-token': csrf, 'idempotency-key': 'target-import-preview' }
      const preview = await targetApp.inject({
        method: 'POST', url: '/api/v1/life/imports/preview', headers,
        payload: {
          formatVersion: job.formatVersion, checksumSha256: job.checksumSha256,
          archiveBase64: job.archiveBase64, mode: 'replace',
        },
      })
      expect(preview.statusCode, preview.body).toBe(200)
      const previewBody = preview.json<{ id: string }>()
      const applied = await targetApp.inject({
        method: 'POST', url: `/api/v1/life/imports/${previewBody.id}/apply`,
        headers: { ...headers, 'idempotency-key': 'target-import-apply' },
        payload: { resolutions: [] },
      })
      expect(applied.statusCode, applied.body).toBe(200)
      const restoredCatalog = await targetApp.inject({ method: 'GET', url: '/api/v1/life/catalog', headers: { cookie } })
      expect(restoredCatalog.json()).toEqual([
        expect.objectContaining({ attachments: [{ mediaId: asset.id, caption: 'Private source photo' }] }),
      ])
      const restoredMedia = await targetApp.inject({ method: 'GET', url: `/api/v1/media/${asset.id}`, headers: { cookie } })
      expect(restoredMedia.statusCode).toBe(200)
      expect(restoredMedia.rawPayload).toEqual(bytes)
    } finally {
      await targetApp.close()
    }
  })

  afterEach(async () => app.close())

  async function client(): Promise<Client> {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { account: 'owner@example.com', password: 'owner-safe-password' },
    })
    expect(login.statusCode).toBe(200)
    const cookie = cookieFrom(login.headers)
    const csrf = login.json<{ csrfToken: string }>().csrfToken
    return {
      get: (url) => app.inject({ method: 'GET', url, headers: { cookie } }),
      write: (options, idempotencyKey) => app.inject({
        ...options,
        headers: {
          ...options.headers,
          cookie,
          'x-csrf-token': csrf,
          'idempotency-key': idempotencyKey,
        },
      }),
    }
  }

  async function createCatalogItem(subject: Client, name: string) {
    const response = await subject.write({
      method: 'POST',
      url: '/api/v1/life/catalog',
      payload: { kind: 'ingredient', name, baseUnit: 'gram', availableUnits: ['gram'] },
    }, `catalog-${name}`)
    expect(response.statusCode).toBe(201)
    return response.json<{ id: string; version: number; name: string }>()
  }

  it('exports versioned JSON and ZIP artifacts with independently verifiable checksums and no auth secrets', async () => {
    const owner = await client()
    const item = await createCatalogItem(owner, 'Portable rice')

    const jsonExport = await owner.write({
      method: 'POST',
      url: '/api/v1/life/exports',
      payload: { format: 'json', includeAttachments: false },
    }, 'export-json')
    expect(jsonExport.statusCode).toBe(201)
    const jsonJob = jsonExport.json<{
      id: string
      status: string
      format: string
      formatVersion: number
      checksumSha256: string
      canonicalJson: string
      recordCounts: Record<string, number>
      payload: { catalogItems: Array<{ id: string }> }
    }>()
    expect(jsonJob).toMatchObject({
      status: 'completed',
      format: 'json',
      formatVersion: 1,
      recordCounts: expect.objectContaining({ catalogItems: 1 }),
      payload: { catalogItems: [expect.objectContaining({ id: item.id })] },
    })
    expect(jsonJob.checksumSha256).toBe(checksum(jsonJob.canonicalJson))
    expect(JSON.parse(jsonJob.canonicalJson)).toEqual(jsonJob.payload)
    expect(jsonJob.payload).not.toHaveProperty('sessions')
    expect(jsonJob.canonicalJson).not.toMatch(/passwordHash|csrfToken|tokenHash|credential|secret/i)

    const zipExport = await owner.write({
      method: 'POST',
      url: '/api/v1/life/exports',
      payload: { format: 'zip', includeAttachments: false },
    }, 'export-zip')
    expect(zipExport.statusCode).toBe(201)
    const zipJob = zipExport.json<{
      status: string
      format: string
      formatVersion: number
      checksumSha256: string
      archiveBase64: string
      archiveEntries: string[]
    }>()
    const archive = Buffer.from(zipJob.archiveBase64, 'base64')
    expect(zipJob).toMatchObject({
      status: 'completed',
      format: 'zip',
      formatVersion: 1,
      archiveEntries: ['manifest.json', 'lifeops.json'],
    })
    expect(archive.subarray(0, 4).toString('hex')).toBe('504b0304')
    expect(zipJob.checksumSha256).toBe(checksum(archive))

    const extra = await createCatalogItem(owner, 'ZIP extra must disappear')
    const preview = await owner.write({
      method: 'POST', url: '/api/v1/life/imports/preview', payload: {
        formatVersion: zipJob.formatVersion, checksumSha256: zipJob.checksumSha256,
        archiveBase64: zipJob.archiveBase64, mode: 'replace',
      },
    }, 'zip-roundtrip-preview')
    expect(preview.statusCode).toBe(200)
    const previewBody = preview.json<{ id: string; conflicts: Array<{ entityType: string; entityId: string }> }>()
    expect(previewBody.conflicts).toEqual([
      expect.objectContaining({ entityType: 'catalog-item', entityId: item.id }),
    ])
    const applied = await owner.write({
      method: 'POST', url: `/api/v1/life/imports/${previewBody.id}/apply`, payload: {
        resolutions: previewBody.conflicts.map((conflict) => ({ ...conflict, resolution: 'use-imported' })),
      },
    }, 'zip-roundtrip-apply')
    expect(applied.statusCode).toBe(200)
    expect((await owner.get(`/api/v1/life/catalog/${extra.id}`)).statusCode).toBe(404)
    expect((await owner.get(`/api/v1/life/catalog/${item.id}`)).statusCode).toBe(200)
  })

  it('includes inventory, day-plan and immutable completion facts in the portable business backup', async () => {
    const owner = await client()
    const catalog = await owner.write({
      method: 'POST',
      url: '/api/v1/life/catalog',
      payload: {
        kind: 'supplement', name: 'Portable supplement', baseUnit: 'each', availableUnits: ['each'],
        pricePoints: [{ amountMinor: 500, currency: 'CNY', purchaseQuantity: 5, purchaseUnit: 'each', effectiveFrom: '2026-08-01' }],
      },
    }, 'portable-supplement')
    expect(catalog.statusCode).toBe(201)
    const item = catalog.json<{ id: string }>()
    const policy = await owner.write({
      method: 'PUT', url: `/api/v1/life/inventory-policies/${item.id}`,
      payload: { minimumStock: 2, packageQuantity: 4, unitId: 'builtin:each' },
    }, 'portable-policy')
    expect(policy.statusCode).toBe(201)
    const stocked = await owner.write({
      method: 'POST',
      url: '/api/v1/life/inventory/transactions',
      payload: { itemId: item.id, kind: 'purchase', quantity: 5, unit: 'each', occurredAt: '2026-08-13T08:00:00.000Z', batch: { actualUnitCostMinor: 100 } },
    }, 'portable-stock')
    expect(stocked.statusCode).toBe(201)
    const day = await owner.write({
      method: 'POST',
      url: '/api/v1/life/day-plans',
      payload: {
        date: '2026-08-14', mealSlots: [],
        items: [{ kind: 'supplement', title: 'Portable supplement', mealSlotId: null, scheduledTime: '09:00', source: { type: 'catalog-item', id: item.id }, quantity: 1, unit: 'each', servings: null, durationMinutes: null }],
      },
    }, 'portable-day')
    expect(day.statusCode).toBe(201)
    const dayBody = day.json<{ id: string; items: Array<{ id: string }> }>()
    const completed = await owner.write({
      method: 'POST',
      url: '/api/v1/life/completions',
      payload: { date: '2026-08-14', dayPlanItemId: dayBody.items[0]!.id, completedAt: '2026-08-14T09:05:00.000Z' },
    }, 'portable-completion')
    expect(completed.statusCode).toBe(201)

    const exported = await owner.write({
      method: 'POST',
      url: '/api/v1/life/exports',
      payload: { format: 'json', includeAttachments: false },
    }, 'portable-business-backup')
    expect(exported.statusCode).toBe(201)
    const payload = exported.json<{ payload: Record<string, Array<Record<string, unknown>>> }>().payload
    expect(payload.inventoryPolicies).toEqual([
      expect.objectContaining({ id: policy.json<{ id: string }>().id, itemId: item.id, version: 1 }),
    ])
    expect(payload.inventoryTransactions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: stocked.json<{ id: string }>().id, itemId: item.id, kind: 'purchase' }),
      expect.objectContaining({ itemId: item.id, kind: 'consume' }),
    ]))
    expect(payload.dayPlans).toEqual([expect.objectContaining({ id: dayBody.id, date: '2026-08-14' })])
    expect(payload.completionSnapshots).toEqual([
      expect.objectContaining({ id: completed.json<{ id: string }>().id, dayPlanId: dayBody.id, costMinor: 100 }),
    ])
  })

  it('restores a complete replace backup transactionally and reproduces its canonical business payload', async () => {
    const owner = await client()
    const original = await owner.write({
      method: 'POST', url: '/api/v1/life/catalog',
      payload: { kind: 'supplement', name: 'Restore original', baseUnit: 'each', availableUnits: ['each'] },
    }, 'restore-original-item')
    expect(original.statusCode).toBe(201)
    const originalItem = original.json<{ id: string }>()
    expect((await owner.write({
      method: 'POST', url: '/api/v1/life/inventory/transactions',
      payload: {
        itemId: originalItem.id, kind: 'purchase', quantity: 5, unit: 'each',
        occurredAt: '2026-08-13T08:00:00.000Z', batch: { actualUnitCostMinor: 100 },
      },
    }, 'restore-original-stock')).statusCode).toBe(201)
    const day = await owner.write({
      method: 'POST', url: '/api/v1/life/day-plans',
      payload: {
        date: '2026-08-14', mealSlots: [], items: [{
          kind: 'supplement', title: 'Restore original', mealSlotId: null, scheduledTime: '09:00',
          source: { type: 'catalog-item', id: originalItem.id }, quantity: 1, unit: 'each',
          servings: null, durationMinutes: null,
        }],
      },
    }, 'restore-original-day')
    expect(day.statusCode).toBe(201)
    const dayBody = day.json<{ items: Array<{ id: string }> }>()
    expect((await owner.write({
      method: 'POST', url: '/api/v1/life/completions',
      payload: { date: '2026-08-14', dayPlanItemId: dayBody.items[0]!.id, completedAt: '2026-08-14T09:05:00.000Z' },
    }, 'restore-original-completion')).statusCode).toBe(201)
    expect((await owner.write({
      method: 'POST', url: '/api/v1/life/budgets',
      payload: {
        name: 'Restore original budget', scope: { kind: 'all-life' },
        period: { kind: 'monthly', startsOn: '2026-08-01', endsOn: '2026-08-31' },
        limitMinor: 1_000, thresholds: [0.5, 0.8, 1], rolloverMinor: 0,
      },
    }, 'restore-original-budget')).statusCode).toBe(201)
    const backup = await owner.write({
      method: 'POST', url: '/api/v1/life/exports',
      payload: { format: 'json', includeAttachments: false },
    }, 'restore-source-backup')
    expect(backup.statusCode).toBe(201)
    const source = backup.json<{ canonicalJson: string; checksumSha256: string }>()

    const extra = await owner.write({
      method: 'POST', url: '/api/v1/life/catalog',
      payload: { kind: 'ingredient', name: 'Must disappear after replace', baseUnit: 'gram', availableUnits: ['gram'] },
    }, 'restore-extra-item')
    expect(extra.statusCode).toBe(201)
    const extraItem = extra.json<{ id: string }>()
    expect((await owner.write({
      method: 'POST', url: '/api/v1/life/inventory/transactions',
      payload: { itemId: extraItem.id, kind: 'purchase', quantity: 50, unit: 'gram', occurredAt: '2026-08-14T10:00:00.000Z' },
    }, 'restore-extra-stock')).statusCode).toBe(201)

    const preview = await owner.write({
      method: 'POST', url: '/api/v1/life/imports/preview',
      payload: {
        formatVersion: 1, checksumSha256: source.checksumSha256,
        canonicalJson: source.canonicalJson, mode: 'replace',
      },
    }, 'restore-preview')
    expect(preview.statusCode).toBe(200)
    const previewBody = preview.json<{ id: string; conflicts: Array<{ entityType: string; entityId: string }> }>()
    expect(previewBody.conflicts).toEqual([
      expect.objectContaining({ entityType: 'catalog-item', entityId: originalItem.id }),
    ])
    const applied = await owner.write({
      method: 'POST', url: `/api/v1/life/imports/${encodeURIComponent(previewBody.id)}/apply`,
      payload: {
        resolutions: previewBody.conflicts.map((conflict) => ({ ...conflict, resolution: 'use-imported' })),
      },
    }, 'restore-apply')
    expect(applied.statusCode).toBe(200)
    expect(applied.json()).toMatchObject({ status: 'applied', restorePointExportId: expect.any(String) })
    expect((await owner.get(`/api/v1/life/catalog/${encodeURIComponent(extraItem.id)}`)).statusCode).toBe(404)

    const verification = await owner.write({
      method: 'POST', url: '/api/v1/life/exports',
      payload: { format: 'json', includeAttachments: false },
    }, 'restore-verification-backup')
    expect(verification.statusCode).toBe(201)
    expect(verification.json<{ canonicalJson: string }>().canonicalJson).toBe(source.canonicalJson)
  })

  it('previews merge conflicts without mutation and requires an explicit resolution before apply', async () => {
    const owner = await client()
    const current = await createCatalogItem(owner, 'Current rice')
    const payload = {
      catalogItems: [{
        id: current.id,
        kind: 'ingredient',
        name: 'Imported rice',
        baseUnit: 'gram',
        availableUnits: ['gram'],
        version: current.version,
      }],
      shoppingItems: [],
      purchases: [],
      refunds: [],
      budgets: [],
    }
    const canonicalJson = JSON.stringify(payload)
    const preview = await owner.write({
      method: 'POST',
      url: '/api/v1/life/imports/preview',
      payload: {
        formatVersion: 1,
        checksumSha256: checksum(canonicalJson),
        canonicalJson,
        mode: 'merge',
      },
    }, 'import-conflict-preview')
    expect(preview.statusCode).toBe(200)
    expect(preview.json()).toMatchObject({
      status: 'conflicts',
      conflicts: [{
        entityType: 'catalog-item',
        entityId: current.id,
        currentVersion: current.version,
        incomingVersion: current.version,
        resolutions: ['keep-current', 'use-imported', 'duplicate'],
      }],
      errors: [],
    })
    const unchanged = await owner.get(`/api/v1/life/catalog/${encodeURIComponent(current.id)}`)
    expect(unchanged.statusCode).toBe(200)
    expect(unchanged.json()).toMatchObject({ id: current.id, name: 'Current rice', version: current.version })

    const applyWithoutResolution = await owner.write({
      method: 'POST',
      url: `/api/v1/life/imports/${encodeURIComponent(preview.json<{ id: string }>().id)}/apply`,
      payload: { resolutions: [] },
    }, 'import-conflict-apply')
    expect(applyWithoutResolution.statusCode).toBe(409)
    expect(applyWithoutResolution.json()).toMatchObject({ error: { code: 'IMPORT_CONFLICTS_UNRESOLVED' } })
  })

  it('executes keep-current, use-imported and duplicate catalog resolutions and makes applied imports terminal', async () => {
    const owner = await client()
    const run = async (
      label: string,
      resolution: 'keep-current' | 'use-imported' | 'duplicate',
      mode: 'merge' | 'replace',
    ) => {
      const current = await createCatalogItem(owner, `${label} current`)
      const currentResponse = await owner.get(`/api/v1/life/catalog/${current.id}`)
      const incoming = { ...currentResponse.json<Record<string, unknown>>(), name: `${label} imported` }
      const payload = { catalogItems: [incoming], shoppingItems: [], purchases: [], refunds: [], budgets: [] }
      const canonicalJson = JSON.stringify(payload)
      const preview = await owner.write({
        method: 'POST', url: '/api/v1/life/imports/preview', payload: {
          formatVersion: 1, checksumSha256: checksum(canonicalJson), canonicalJson, mode,
        },
      }, `${label}-preview`)
      expect(preview.statusCode).toBe(200)
      const importId = preview.json<{ id: string }>().id
      const applied = await owner.write({
        method: 'POST', url: `/api/v1/life/imports/${importId}/apply`, payload: {
          resolutions: [{ entityType: 'catalog-item', entityId: current.id, resolution }],
        },
      }, `${label}-apply`)
      expect(applied.statusCode).toBe(200)
      return { current, importId, applied: applied.json<Record<string, unknown>>() }
    }

    const kept = await run('resolution-keep', 'keep-current', 'replace')
    expect((await owner.get(`/api/v1/life/catalog/${kept.current.id}`)).json()).toMatchObject({ name: 'resolution-keep current' })
    const keptReplay = await owner.write({
      method: 'POST', url: `/api/v1/life/imports/${kept.importId}/apply`, payload: {
        resolutions: [{ entityType: 'catalog-item', entityId: kept.current.id, resolution: 'keep-current' }],
      },
    }, 'resolution-keep-second-transport-key')
    expect(keptReplay.statusCode).toBe(200)
    expect(keptReplay.json()).toEqual(kept.applied)

    const imported = await run('resolution-import', 'use-imported', 'merge')
    expect((await owner.get(`/api/v1/life/catalog/${imported.current.id}`)).json()).toMatchObject({ name: 'resolution-import imported' })

    const duplicated = await run('resolution-duplicate', 'duplicate', 'merge')
    expect((await owner.get(`/api/v1/life/catalog/${duplicated.current.id}`)).json()).toMatchObject({ name: 'resolution-duplicate current' })
    const catalog = (await owner.get('/api/v1/life/catalog')).json<Array<{ id: string; name: string }>>()
    expect(catalog).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: duplicated.current.id, name: 'resolution-duplicate current' }),
      expect.objectContaining({ name: 'resolution-duplicate imported' }),
    ]))
    expect(catalog.filter((item) => item.name === 'resolution-duplicate imported')).toHaveLength(1)
  })

  it('rejects history-bearing merge payloads instead of reporting a partial merge as applied', async () => {
    const owner = await client()
    const payload = {
      catalogItems: [], shoppingItems: [], purchases: [{ id: 'unsupported-merge-purchase' }], refunds: [], budgets: [],
    }
    const canonicalJson = JSON.stringify(payload)
    const preview = await owner.write({
      method: 'POST', url: '/api/v1/life/imports/preview', payload: {
        formatVersion: 1, checksumSha256: checksum(canonicalJson), canonicalJson, mode: 'merge',
      },
    }, 'history-merge-preview')
    expect(preview.statusCode).toBe(200)
    expect(preview.json()).toMatchObject({
      status: 'invalid',
      errors: expect.arrayContaining([expect.objectContaining({ code: 'IMPORT_MODE_REQUIRES_REPLACE', entityType: 'purchase' })]),
    })
  })

  it('creates a restore point and leaves zero partial rows when any imported row is invalid', async () => {
    const owner = await client()
    const payload = {
      catalogItems: [],
      shoppingItems: [],
      purchases: [],
      refunds: [],
      budgets: [
        {
          id: 'import-budget-valid',
          name: 'Valid first row',
          scope: { kind: 'all-life' },
          period: { kind: 'monthly', startsOn: '2026-08-01', endsOn: '2026-08-31' },
          limitMinor: 1_000,
          thresholds: [0.5, 0.8, 1],
          rolloverMinor: 0,
          version: 1,
        },
        {
          id: 'import-budget-invalid',
          name: 'Invalid second row',
          scope: { kind: 'all-life' },
          period: { kind: 'custom', startsOn: '2026-08-31', endsOn: '2026-08-01' },
          limitMinor: -1,
          thresholds: [0.8, 0.5],
          rolloverMinor: 0,
          version: 1,
        },
      ],
    }
    const canonicalJson = JSON.stringify(payload)
    const preview = await owner.write({
      method: 'POST',
      url: '/api/v1/life/imports/preview',
      payload: {
        formatVersion: 1,
        checksumSha256: checksum(canonicalJson),
        canonicalJson,
        mode: 'replace',
      },
    }, 'import-invalid-preview')
    expect(preview.statusCode).toBe(200)
    expect(preview.json()).toMatchObject({
      status: 'invalid',
      errors: [expect.objectContaining({ entityType: 'budget', entityId: 'import-budget-invalid' })],
    })

    const apply = await owner.write({
      method: 'POST',
      url: `/api/v1/life/imports/${encodeURIComponent(preview.json<{ id: string }>().id)}/apply`,
      payload: { resolutions: [] },
    }, 'import-invalid-apply')
    expect(apply.statusCode).toBe(409)
    expect(apply.json()).toMatchObject({
      error: {
        code: 'IMPORT_VALIDATION_FAILED',
        details: { restorePointExportId: expect.any(String), appliedRows: 0 },
      },
      restorePointExportId: expect.any(String),
      appliedRows: 0,
    })
    expect((await owner.get('/api/v1/life/budgets?asOf=2026-08-14')).json()).toEqual([])
    const exports = await owner.get('/api/v1/life/exports')
    expect(exports.json()).toEqual([
      expect.objectContaining({ id: apply.json<{ restorePointExportId: string }>().restorePointExportId, reason: 'pre-import-restore-point' }),
    ])
  })

  it('rejects dangling portable relationships during preview before any owner row can be replaced', async () => {
    const owner = await client()
    const payload = {
      catalogItems: [{ id: 'existing-import-item' }], shoppingItems: [], purchases: [], refunds: [], budgets: [],
      inventoryPolicies: [{
        id: 'dangling-policy-unit', itemId: 'existing-import-item', minimumStock: 0, packageQuantity: 1,
        unitId: 'missing-unit', unit: 'each', version: 1,
        createdAt: '2026-08-14T09:00:00.000Z', updatedAt: '2026-08-14T09:00:00.000Z',
      }],
      inventoryTransactions: [{
        id: 'existing-import-transaction', itemId: 'existing-import-item', batchId: null,
        reversesTransactionId: null, reversedByTransactionId: null, allocations: [],
      }],
      purchaseItems: [{
        id: 'dangling-purchase-item', purchaseId: null, shoppingItemId: null,
        itemId: 'existing-import-item', quantity: 1, unit: 'each', amountMinor: 100,
        updateCurrentPrice: false, inventoryTransactionId: 'existing-import-transaction',
      }],
    }
    const canonicalJson = JSON.stringify(payload)
    const preview = await owner.write({
      method: 'POST', url: '/api/v1/life/imports/preview',
      payload: { formatVersion: 1, checksumSha256: checksum(canonicalJson), canonicalJson, mode: 'replace' },
    }, 'dangling-preview')
    expect(preview.statusCode).toBe(200)
    expect(preview.json()).toMatchObject({
      status: 'invalid',
      errors: expect.arrayContaining([
        expect.objectContaining({
          entityType: 'purchase-item', entityId: 'dangling-purchase-item',
          code: 'IMPORT_RELATION_MISSING',
        }),
        expect.objectContaining({ entityType: 'inventory-policy', entityId: 'dangling-policy-unit', code: 'IMPORT_RELATION_MISSING' }),
      ]),
    })

    const applied = await owner.write({
      method: 'POST',
      url: `/api/v1/life/imports/${encodeURIComponent(preview.json<{ id: string }>().id)}/apply`,
      payload: { resolutions: [] },
    }, 'dangling-apply')
    expect(applied.statusCode).toBe(409)
    expect(applied.json()).toMatchObject({ error: { code: 'IMPORT_VALIDATION_FAILED' }, appliedRows: 0 })
  })

  it('rejects dangling nested recipe, planning, media and taxonomy graphs during preview', async () => {
    const owner = await client()
    const payload = {
      catalogItems: [{
        id: 'nested-catalog-item', kind: 'ingredient', name: 'Nested item', baseUnit: 'gram',
        availableUnits: ['gram'], categoryId: 'missing-category', locationId: 'missing-location',
        tagIds: ['missing-tag'], attachments: [],
      }],
      inventoryPolicies: [{
        id: 'nested-incompatible-policy', itemId: 'nested-catalog-item', minimumStock: 0, packageQuantity: 1,
        unitId: 'builtin:each', unit: 'each', version: 1,
        createdAt: '2026-08-14T09:00:00.000Z', updatedAt: '2026-08-14T09:00:00.000Z',
      }],
      shoppingItems: [], purchases: [], refunds: [],
      budgets: [{
        id: 'nested-budget', name: 'Nested budget', scope: { kind: 'category', categoryIds: ['missing-category'] },
        period: { kind: 'monthly', startsOn: '2026-08-01', endsOn: '2026-08-31' },
        limitMinor: 1_000, thresholds: [0.5,0.8,1], rolloverMinor: 0, version: 1,
        createdAt: '2026-08-14T09:00:00.000Z', updatedAt: '2026-08-14T09:00:00.000Z',
      }],
      recipes: [{
        id: 'nested-recipe', currentVersion: { id: 'missing-current-version' },
        coverMediaId: 'missing-cover', categoryId: 'missing-category', tagIds: ['missing-tag'],
      }],
      recipeVersions: [{
        id: 'nested-version', recipeId: 'missing-recipe', number: 1, servings: 1,
        components: [{ id: 'nested-component', itemId: 'missing-ingredient' }],
        steps: [{ id: 'nested-step', ingredientItemIds: ['missing-ingredient'], imageMediaId: 'missing-step-media' }],
      }],
      cookingSessions: [{ id: 'nested-session', recipeId: 'missing-recipe', recipeVersionId: 'missing-version' }],
      cookingCompletions: [{
        id: 'nested-cooking-completion', cookingSessionId: 'missing-session',
        recipeId: 'missing-recipe', recipeVersionId: 'missing-version',
      }],
      preparedFood: [{
        id: 'nested-prepared-food', cookingSnapshotId: 'missing-cooking-completion',
        recipeId: 'missing-recipe', recipeVersionId: 'missing-version',
      }],
      planTemplates: [{
        id: 'nested-template', items: [{ id: 'nested-template-item', source: { type: 'recipe-version', id: 'missing-recipe', versionId: 'missing-version' } }],
      }],
      dayPlans: [{
        id: 'nested-day', items: [{ id: 'nested-day-item', source: { type: 'catalog-item', id: 'missing-catalog-item' } }],
      }],
      medicineRecurrenceRules: [{ id: 'nested-rule', sourceId: 'missing-medicine' }],
      medicineOccurrences: [{ id: 'nested-occurrence', ruleId: 'missing-rule', source: { type: 'catalog-item', id: 'missing-medicine' } }],
      completionSnapshots: [{
        id: 'nested-completion', dayPlanId: 'missing-day', dayPlanItemId: 'missing-day-item',
        completionSource: { type: 'day-plan-item', dayPlanId: 'missing-day', dayPlanItemId: 'missing-day-item' },
        inventoryTransactionIds: ['missing-transaction'], preparedFoodEventIds: ['missing-prepared-event'],
      }],
      completionPreparedFoodEvents: [{
        completionId: 'missing-completion', events: [{ id: 'nested-prepared-event', stockId: 'missing-prepared-stock' }],
      }],
      templateApplications: [{ id: 'nested-application', templateId: 'missing-template', dayPlanId: 'missing-day' }],
    }
    const canonicalJson = JSON.stringify(payload)
    const preview = await owner.write({
      method: 'POST', url: '/api/v1/life/imports/preview', payload: {
        formatVersion: 1, checksumSha256: checksum(canonicalJson), canonicalJson, mode: 'replace',
      },
    }, 'dangling-nested-preview')
    expect(preview.statusCode).toBe(200)
    expect(preview.json()).toMatchObject({
      status: 'invalid', errors: expect.arrayContaining([
        expect.objectContaining({ entityType: 'catalog-item', entityId: 'nested-catalog-item', code: 'IMPORT_RELATION_MISSING' }),
        expect.objectContaining({ entityType: 'inventory-policy', entityId: 'nested-incompatible-policy', code: 'IMPORT_POLICY_UNIT_INCOMPATIBLE' }),
        expect.objectContaining({ entityType: 'budget', entityId: 'nested-budget', code: 'IMPORT_RELATION_MISSING' }),
        expect.objectContaining({ entityType: 'recipe-version', entityId: 'nested-version', code: 'IMPORT_RELATION_MISSING' }),
        expect.objectContaining({ entityType: 'cooking-session', entityId: 'nested-session', code: 'IMPORT_RELATION_MISSING' }),
        expect.objectContaining({ entityType: 'day-plan', entityId: 'nested-day', code: 'IMPORT_RELATION_MISSING' }),
        expect.objectContaining({ entityType: 'completion-snapshot', entityId: 'nested-completion', code: 'IMPORT_RELATION_MISSING' }),
        expect.objectContaining({ entityType: 'template-application', entityId: 'nested-application', code: 'IMPORT_RELATION_MISSING' }),
      ]),
    })
  })

  it('reports malformed portable rows during preview instead of deferring corruption to apply', async () => {
    const owner = await client()
    const payload = {
      catalogItems: [{ id: 'malformed-item', kind: 'ingredient' }],
      shoppingItems: [], purchases: [], refunds: [], budgets: [],
      inventoryPolicies: [{
        id: 'malformed-policy', itemId: 'malformed-item', minimumStock: -1, packageQuantity: 0,
        unitId: 'builtin:each', unit: 'each', version: 0,
        createdAt: '2026-08-14T09:00:00.000Z', updatedAt: '2026-08-14T09:00:00.000Z',
      }],
      shoppingSuggestions: [{
        id: 'malformed-suggestion', kind: 'suggestion', origin: 'derived', through: null,
        itemId: 'malformed-item', requiredQuantity: 1, suggestedQuantity: 1, unit: 'each', packageQuantity: 1,
        reasons: [], createdAt: '2026-08-14T09:00:00.000Z', updatedAt: '2026-08-14T09:00:00.000Z',
      }],
      recipeVersions: [{ id: 'malformed-version', recipeId: null, components: 'not-an-array', steps: [] }],
      recipes: [{ id: 'malformed-recipe', name: null, currentVersion: 'not-an-object' }],
      dayPlans: [{ id: 'malformed-day-plan', date: null, mealSlots: 'not-an-array', items: [] }],
      planTemplates: [{ id: 'malformed-template', name: '', mealSlots: [], items: 'not-an-array' }],
    }
    const canonicalJson = JSON.stringify(payload)
    const preview = await owner.write({
      method: 'POST', url: '/api/v1/life/imports/preview', payload: {
        formatVersion: 1, checksumSha256: checksum(canonicalJson), canonicalJson, mode: 'replace',
      },
    }, 'malformed-row-preview')
    expect(preview.statusCode).toBe(200)
    expect(preview.json()).toMatchObject({
      status: 'invalid', errors: expect.arrayContaining([
        expect.objectContaining({ entityType: 'catalog-item', entityId: 'malformed-item', code: 'IMPORT_ROW_INVALID' }),
        expect.objectContaining({ entityType: 'inventory-policy', entityId: 'malformed-policy', code: 'IMPORT_ROW_INVALID' }),
        expect.objectContaining({ entityType: 'shopping-suggestion', entityId: 'malformed-suggestion', code: 'IMPORT_ROW_INVALID' }),
        expect.objectContaining({ entityType: 'recipe-version', entityId: 'malformed-version', code: 'IMPORT_ROW_INVALID' }),
        expect.objectContaining({ entityType: 'recipe', entityId: 'malformed-recipe', code: 'IMPORT_ROW_INVALID' }),
        expect.objectContaining({ entityType: 'day-plan', entityId: 'malformed-day-plan', code: 'IMPORT_ROW_INVALID' }),
        expect.objectContaining({ entityType: 'plan-template', entityId: 'malformed-template', code: 'IMPORT_ROW_INVALID' }),
      ]),
    })
  })

  it('retains one restore point and rolls back every owner row after a mid-apply failure', async () => {
    const owner = await client()
    expect((await owner.write({
      method: 'POST',
      url: '/api/v1/life/budgets',
      payload: {
        name: 'Baseline budget', scope: { kind: 'all-life' },
        period: { kind: 'monthly', startsOn: '2026-08-01', endsOn: '2026-08-31' },
        limitMinor: 900, thresholds: [0.5, 0.8, 1], rolloverMinor: 0,
      },
    }, 'baseline-budget')).statusCode).toBe(201)
    const payload = {
      catalogItems: [], shoppingItems: [], purchases: [], refunds: [],
      budgets: [{
        id: 'imported-budget', name: 'Imported budget', scope: { kind: 'all-life' },
        period: { kind: 'monthly', startsOn: '2026-08-01', endsOn: '2026-08-31' },
        limitMinor: 1_500, thresholds: [0.5, 0.8, 1], rolloverMinor: 0, version: 1,
        createdAt: '2026-08-14T09:00:00.000Z', updatedAt: '2026-08-14T09:00:00.000Z',
      }],
    }
    const canonicalJson = JSON.stringify(payload)
    const preview = await owner.write({
      method: 'POST', url: '/api/v1/life/imports/preview',
      payload: { formatVersion: 1, checksumSha256: checksum(canonicalJson), canonicalJson, mode: 'replace' },
    }, 'mid-apply-preview')
    expect(preview.statusCode).toBe(200)
    const importId = preview.json<{ id: string }>().id

    let shouldFail = true
    transactionObserver = (event) => {
      if (shouldFail && event.operation === 'commerce:apply-import' && event.phase === 'business-data-replaced') {
        shouldFail = false
        throw new Error('injected import failure after business replacement')
      }
    }
    const failed = await owner.write({
      method: 'POST', url: `/api/v1/life/imports/${encodeURIComponent(importId)}/apply`,
      payload: { resolutions: [] },
    }, 'mid-apply-key')
    expect(failed.statusCode).toBe(500)
    expect((await owner.get('/api/v1/life/budgets?asOf=2026-08-14')).json()).toEqual([
      expect.objectContaining({ name: 'Baseline budget', limitMinor: 900 }),
    ])
    const restorePoints = (await owner.get('/api/v1/life/exports')).json<Array<{ id: string; reason: string }>>()
      .filter((entry) => entry.reason === 'pre-import-restore-point')
    expect(restorePoints).toHaveLength(1)

    const retried = await owner.write({
      method: 'POST', url: `/api/v1/life/imports/${encodeURIComponent(importId)}/apply`,
      payload: { resolutions: [] },
    }, 'mid-apply-key')
    expect(retried.statusCode).toBe(200)
    expect(retried.json()).toMatchObject({
      status: 'applied', restorePointExportId: restorePoints[0]!.id,
    })
    expect((await owner.get('/api/v1/life/budgets?asOf=2026-08-14')).json()).toEqual([
      expect.objectContaining({ id: 'imported-budget', name: 'Imported budget', limitMinor: 1_500 }),
    ])
    const afterRetry = (await owner.get('/api/v1/life/exports')).json<Array<{ reason: string }>>()
      .filter((entry) => entry.reason === 'pre-import-restore-point')
    expect(afterRetry).toHaveLength(1)
  })

  it('holds owner mutations behind the restore-point-to-replace boundary', async () => {
    const owner = await client()
    const payload = {
      catalogItems: [], shoppingItems: [], purchases: [], refunds: [], budgets: [{
        id: 'serialized-import-budget', name: 'Serialized import', scope: { kind: 'all-life' },
        period: { kind: 'monthly', startsOn: '2026-08-01', endsOn: '2026-08-31' },
        limitMinor: 1_000, thresholds: [0.5, 0.8, 1], rolloverMinor: 0, version: 1,
        createdAt: '2026-08-14T09:00:00.000Z', updatedAt: '2026-08-14T09:00:00.000Z',
      }],
    }
    const canonicalJson = JSON.stringify(payload)
    const preview = await owner.write({
      method: 'POST', url: '/api/v1/life/imports/preview', payload: {
        formatVersion: 1, checksumSha256: checksum(canonicalJson), canonicalJson, mode: 'replace',
      },
    }, 'serialized-import-preview')
    const importId = preview.json<{ id: string }>().id
    let prepared!: () => void
    let release!: () => void
    const preparedGate = new Promise<void>((resolve) => { prepared = resolve })
    const releaseGate = new Promise<void>((resolve) => { release = resolve })
    transactionObserver = async (event) => {
      if (event.operation === 'commerce:apply-import' && event.phase === 'restore-point-persisted') {
        prepared()
        await releaseGate
      }
    }
    const applying = owner.write({
      method: 'POST', url: `/api/v1/life/imports/${importId}/apply`, payload: { resolutions: [] },
    }, 'serialized-import-apply')
    await Promise.race([
      preparedGate,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('restore-point boundary was not observable')), 500)),
    ])
    let mutationSettled = false
    const concurrentMutation = owner.write({
      method: 'POST', url: '/api/v1/life/budgets', payload: {
        name: 'After import mutation', scope: { kind: 'all-life' },
        period: { kind: 'monthly', startsOn: '2026-08-01', endsOn: '2026-08-31' },
        limitMinor: 500, thresholds: [0.5, 0.8, 1], rolloverMinor: 0,
      },
    }, 'serialized-after-budget').then((response) => { mutationSettled = true; return response })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mutationSettled).toBe(false)
    release()
    expect((await applying).statusCode).toBe(200)
    expect((await concurrentMutation).statusCode).toBe(201)
    expect((await owner.get('/api/v1/life/budgets?asOf=2026-08-14')).json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'serialized-import-budget' }),
      expect.objectContaining({ name: 'After import mutation' }),
    ]))
  })
})

import { safeIntegrationFetch } from './safeFetch.js'
import type { IntegrationConfig, PlatformSourceState } from './types.js'

type JsonRecord = Record<string, unknown>
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value)
  ? value as JsonRecord
  : {}
const text = (value: unknown): string | null => typeof value === 'string' ? value : null

interface DeliveryOptions {
  github: { config: IntegrationConfig; repository: string }
  argoCd: { config: IntegrationConfig; application: string }
}

function validSegment(value: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(value)
}

function parseImages(values: unknown): Record<string, { repository: string; tag: string; digest: string }> {
  const images: Record<string, { repository: string; tag: string; digest: string }> = {}
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== 'string') continue
    const match = value.match(/^(.*):([^:@/]+)@(sha256:[a-f0-9]{64})$/i)
    if (!match) continue
    const repository = match[1]
    const component = /(?:^|[-_/])web$/i.test(repository) ? 'web' : /(?:^|[-_/])api$/i.test(repository) ? 'api' : null
    if (component) images[component] = { repository, tag: match[2], digest: match[3] }
  }
  return images
}

async function githubStatus(config: IntegrationConfig, repository: string) {
  const parts = repository.split('/')
  if (parts.length !== 2 || !parts.every(validSegment)) throw new Error('DELIVERY_SOURCE_REJECTED')
  const response = await safeIntegrationFetch<JsonRecord>(config, `/repos/${parts[0]}/${parts[1]}/actions/runs`, {
    query: { per_page: 1 },
  })
  const run = (Array.isArray(response.workflow_runs) ? response.workflow_runs.map(record) : [])[0]
  return {
    state: 'connected' as PlatformSourceState,
    deepLinkUrl: config.deepLinkUrl,
    latestRun: run ? {
      id: typeof run.id === 'number' ? run.id : null,
      number: typeof run.run_number === 'number' ? run.run_number : null,
      status: text(run.status),
      conclusion: text(run.conclusion),
      revision: text(run.head_sha),
      createdAt: text(run.created_at),
      updatedAt: text(run.updated_at),
    } : null,
  }
}

async function argoStatus(config: IntegrationConfig, application: string) {
  if (!validSegment(application)) throw new Error('DELIVERY_SOURCE_REJECTED')
  const response = await safeIntegrationFetch<JsonRecord>(config, `/api/v1/applications/${application}`)
  const status = record(response.status)
  return {
    state: 'connected' as PlatformSourceState,
    deepLinkUrl: config.deepLinkUrl,
    sync: text(record(status.sync).status) ?? 'Unknown',
    health: text(record(status.health).status) ?? 'Unknown',
    revision: text(record(status.sync).revision),
    images: parseImages(record(status.summary).images),
  }
}

export async function fetchDeliverySummary(options: DeliveryOptions) {
  const [githubResult, argoResult] = await Promise.allSettled([
    githubStatus(options.github.config, options.github.repository),
    argoStatus(options.argoCd.config, options.argoCd.application),
  ])
  const github = githubResult.status === 'fulfilled' ? githubResult.value : {
    state: options.github.config.enabled ? 'degraded' as const : 'disabled' as const,
    deepLinkUrl: options.github.config.deepLinkUrl,
    latestRun: null,
  }
  const argoCd = argoResult.status === 'fulfilled' ? argoResult.value : {
    state: options.argoCd.config.enabled ? 'degraded' as const : 'disabled' as const,
    deepLinkUrl: options.argoCd.config.deepLinkUrl,
    sync: 'Unknown',
    health: 'Unknown',
    revision: null,
    images: {},
  }
  return {
    state: github.state === 'connected' && argoCd.state === 'connected' ? 'connected' : 'degraded',
    github,
    argoCd,
    images: argoCd.images,
  }
}

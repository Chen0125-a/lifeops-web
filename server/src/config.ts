import type { IntegrationConfig } from './integrations/types.js'

export type MediaStorageConfig =
  | { backend: 'filesystem'; root: string }
  | { backend: 's3'; endpoint: string; region: string; bucket: string; forcePathStyle: boolean }

export interface RuntimeConfig {
  host: string
  port: number
  store: 'mysql' | 'memory'
  mediaStorage: MediaStorageConfig
  mysql: { host: string; port: number; database: string; user: string; password: string; connectionLimit: number }
  app: { cookieName: string; sessionTtlSeconds: number; secureCookies: boolean; allowedOrigins: string[]; logger: boolean; trustProxy: false | string[]; publicOrigin: string }
  bootstrap: { account: string; password: string; displayName: string }
  integrations: {
    kubernetes: IntegrationConfig
    prometheus: IntegrationConfig
    alertmanager: IntegrationConfig
    elasticsearch: IntegrationConfig
    github: IntegrationConfig
    argoCd: IntegrationConfig
  }
}

const integer = (value: string | undefined, fallback: number, field: string) => {
  const result = Number(value ?? fallback)
  if (!Number.isInteger(result) || result <= 0) throw new Error(`${field} 必须是正整数`)
  return result
}

const required = (value: string | undefined, field: string) => {
  if (!value?.trim()) throw new Error(`缺少环境变量 ${field}`)
  return value.trim()
}

const mediaStorage = (env: NodeJS.ProcessEnv): MediaStorageConfig => {
  const backend = env.LIFEOPS_MEDIA_BACKEND?.trim() || 'filesystem'
  if (backend === 'filesystem') {
    return { backend, root: env.LIFEOPS_MEDIA_ROOT?.trim() || 'data/media' }
  }
  if (backend !== 's3') throw new Error('LIFEOPS_MEDIA_BACKEND 必须是 filesystem 或 s3')
  const forcePathStyle = env.LIFEOPS_S3_FORCE_PATH_STYLE?.trim() || 'true'
  if (!['true', 'false'].includes(forcePathStyle)) {
    throw new Error('LIFEOPS_S3_FORCE_PATH_STYLE 必须是 true 或 false')
  }
  return {
    backend,
    endpoint: required(env.LIFEOPS_S3_ENDPOINT, 'LIFEOPS_S3_ENDPOINT'),
    region: required(env.LIFEOPS_S3_REGION, 'LIFEOPS_S3_REGION'),
    bucket: required(env.LIFEOPS_S3_BUCKET, 'LIFEOPS_S3_BUCKET'),
    forcePathStyle: forcePathStyle === 'true',
  }
}

const boundedInteger = (
  value: string | undefined,
  fallback: number,
  field: string,
  minimum: number,
  maximum: number,
) => {
  const result = Number(value ?? fallback)
  if (!Number.isInteger(result) || result < minimum || result > maximum) {
    throw new Error(`${field} 必须是 ${minimum} 到 ${maximum} 之间的整数`)
  }
  return result
}

const httpUrl = (value: string | undefined, field: string, requiredWhenEnabled = false) => {
  const normalized = value?.trim()
  if (!normalized) {
    if (requiredWhenEnabled) throw new Error(`缺少环境变量 ${field}`)
    return null
  }
  try {
    const parsed = new URL(normalized)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error('unsafe URL')
    }
    return parsed.toString()
  } catch {
    throw new Error(`${field} 必须是无凭据的 http 或 https URL`)
  }
}

const integration = (env: NodeJS.ProcessEnv, prefix: string): IntegrationConfig => {
  const enabled = env[`${prefix}_ENABLED`] === 'true'
  const baseUrl = httpUrl(env[`${prefix}_BASE_URL`], `${prefix}_BASE_URL`, enabled)
  const deepLinkUrl = httpUrl(env[`${prefix}_DEEP_LINK_URL`], `${prefix}_DEEP_LINK_URL`)
  const username = env[`${prefix}_USERNAME`]?.trim()
  const password = env[`${prefix}_PASSWORD`]
  if (Boolean(username) !== Boolean(password)) {
    throw new Error(`${prefix}_USERNAME 与 ${prefix}_PASSWORD 必须同时设置`)
  }
  const auth = {
    ...(env[`${prefix}_BEARER_TOKEN`] ? { bearerToken: env[`${prefix}_BEARER_TOKEN`] } : {}),
    ...(env[`${prefix}_BEARER_TOKEN_FILE`]?.trim()
      ? { bearerTokenFile: env[`${prefix}_BEARER_TOKEN_FILE`]?.trim() }
      : {}),
    ...(env[`${prefix}_CA_FILE`]?.trim() ? { caFile: env[`${prefix}_CA_FILE`]?.trim() } : {}),
    ...(username && password ? { basic: { username, password } } : {}),
  }
  const config: IntegrationConfig = {
    enabled,
    baseUrl,
    timeoutMs: boundedInteger(env[`${prefix}_TIMEOUT_MS`], 3_000, `${prefix}_TIMEOUT_MS`, 500, 10_000),
    maxResponseBytes: boundedInteger(
      env[`${prefix}_MAX_RESPONSE_BYTES`],
      256 * 1024,
      `${prefix}_MAX_RESPONSE_BYTES`,
      64 * 1024,
      2 * 1024 * 1024,
    ),
    deepLinkUrl,
    auth,
  }
  Object.defineProperty(config, 'toJSON', {
    enumerable: false,
    value: () => ({ enabled: config.enabled, deepLinkUrl: config.deepLinkUrl }),
  })
  return config
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const store = env.LIFEOPS_STORE === 'memory' ? 'memory' : 'mysql'
  const port = integer(env.PORT, 8080, 'PORT')
  const account = required(env.LIFEOPS_ADMIN_ACCOUNT, 'LIFEOPS_ADMIN_ACCOUNT')
  const password = required(env.LIFEOPS_ADMIN_PASSWORD, 'LIFEOPS_ADMIN_PASSWORD')
  if (password.length < 12) throw new Error('LIFEOPS_ADMIN_PASSWORD 至少需要 12 个字符')
  return {
    host: env.HOST?.trim() || '0.0.0.0',
    port,
    store,
    mediaStorage: mediaStorage(env),
    mysql: {
      host: store === 'mysql' ? required(env.MYSQL_HOST, 'MYSQL_HOST') : (env.MYSQL_HOST || '127.0.0.1'),
      port: integer(env.MYSQL_PORT, 3306, 'MYSQL_PORT'),
      database: store === 'mysql' ? required(env.MYSQL_DATABASE, 'MYSQL_DATABASE') : (env.MYSQL_DATABASE || 'lifeops'),
      user: store === 'mysql' ? required(env.MYSQL_USER, 'MYSQL_USER') : (env.MYSQL_USER || 'lifeops'),
      password: store === 'mysql' ? required(env.MYSQL_PASSWORD, 'MYSQL_PASSWORD') : (env.MYSQL_PASSWORD || ''),
      connectionLimit: integer(env.MYSQL_CONNECTION_LIMIT, 10, 'MYSQL_CONNECTION_LIMIT'),
    },
    app: {
      cookieName: env.LIFEOPS_COOKIE_NAME?.trim() || 'lifeops_session',
      sessionTtlSeconds: integer(env.LIFEOPS_SESSION_TTL_SECONDS, 8 * 60 * 60, 'LIFEOPS_SESSION_TTL_SECONDS'),
      secureCookies: env.LIFEOPS_SECURE_COOKIES !== 'false',
      allowedOrigins: (env.LIFEOPS_ALLOWED_ORIGINS ?? '').split(',').map((item) => item.trim()).filter(Boolean),
      logger: env.LIFEOPS_LOGGER !== 'false',
      trustProxy: env.LIFEOPS_TRUST_PROXY?.trim()
        ? env.LIFEOPS_TRUST_PROXY.split(',').map((item) => item.trim()).filter(Boolean)
        : false,
      publicOrigin: env.LIFEOPS_PUBLIC_ORIGIN?.trim() || `http://localhost:${port}`,
    },
    bootstrap: { account, password, displayName: env.LIFEOPS_ADMIN_DISPLAY_NAME?.trim() || 'LifeOps Owner' },
    integrations: {
      kubernetes: integration(env, 'LIFEOPS_KUBERNETES'),
      prometheus: integration(env, 'LIFEOPS_PROMETHEUS'),
      alertmanager: integration(env, 'LIFEOPS_ALERTMANAGER'),
      elasticsearch: integration(env, 'LIFEOPS_ELASTICSEARCH'),
      github: integration(env, 'LIFEOPS_GITHUB'),
      argoCd: integration(env, 'LIFEOPS_ARGOCD'),
    },
  }
}

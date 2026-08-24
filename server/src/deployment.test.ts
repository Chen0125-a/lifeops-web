import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

describe('production delivery contract', () => {
  it('builds two non-root images from pinned runtime versions', async () => {
    const [web, api] = await Promise.all([read('Dockerfile'), read('server/Dockerfile')])
    expect(web).toContain('FROM node:24.17.0-alpine3.23')
    expect(web).toContain('USER nginx')
    expect(api).toContain('FROM node:24.17.0-alpine3.23')
    expect(api).toContain('USER lifeops')
    expect(api).toContain('HEALTHCHECK')
  })

  it('renders web, API and optional MySQL as distinct workloads', async () => {
    const [values, apiDeployment, mysql, secret] = await Promise.all([
      read('deploy/helm/lifeops-web/values.yaml'),
      read('deploy/helm/lifeops-web/templates/api-deployment.yaml'),
      read('deploy/helm/lifeops-web/templates/mysql-statefulset.yaml'),
      read('deploy/helm/lifeops-web/templates/secret.yaml'),
    ])
    expect(values).toContain('uhub.service.ucloud.cn/chenucloud/lifeops-web')
    expect(values).toContain('uhub.service.ucloud.cn/chenucloud/lifeops-api')
    expect(apiDeployment).toContain('readOnlyRootFilesystem: true')
    expect(mysql).toContain('volumeClaimTemplates:')
    expect(secret).toContain('kind: Secret')
    expect(secret).toContain('.Values.secrets.create')
  })

  it('runs the store contract against a real MySQL 8.4 service in CI', async () => {
    const workflow = await read('.github/workflows/ci.yml')
    expect(workflow).toContain('mysql:8.4.10')
    expect(workflow).toContain('test:mysql')
    expect(workflow).toContain('LIFEOPS_MYSQL_INTEGRATION: "true"')
  })

  it('publishes immutable digests and updates the GitOps values file', async () => {
    const workflow = await read('.github/workflows/release.yml')
    expect(workflow).toContain('uhub.service.ucloud.cn/chenucloud/lifeops-web')
    expect(workflow).toContain('uhub.service.ucloud.cn/chenucloud/lifeops-api')
    expect(workflow).toContain('docker buildx imagetools inspect')
    expect(workflow).toContain('environments/production/values.yaml')
  })
})

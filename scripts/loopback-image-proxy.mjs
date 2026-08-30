import { createServer, request as createRequest } from 'node:http'

const upstream = new URL(process.env.LIFEOPS_IMAGE_BROWSER_UPSTREAM ?? '')
if (upstream.protocol !== 'http:') throw new Error('IMAGE_BROWSER_UPSTREAM_INVALID')

const server = createServer((request, response) => {
  const headers = { ...request.headers, host: upstream.host }
  delete headers.connection

  const proxyRequest = createRequest({
    hostname: upstream.hostname,
    port: upstream.port || 80,
    method: request.method,
    path: request.url,
    headers,
  }, (proxyResponse) => {
    const responseHeaders = { ...proxyResponse.headers }
    delete responseHeaders.connection
    response.writeHead(proxyResponse.statusCode ?? 502, responseHeaders)
    proxyResponse.pipe(response)
  })

  proxyRequest.on('error', () => {
    if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('IMAGE_BROWSER_UPSTREAM_UNAVAILABLE')
  })
  request.pipe(proxyRequest)
})

server.on('error', () => {
  process.stderr.write('IMAGE_BROWSER_LOOPBACK_PROXY_FAILED\n')
  process.exitCode = 1
})
server.listen(8081, '127.0.0.1', () => process.stdout.write('IMAGE_BROWSER_LOOPBACK_PROXY_READY\n'))

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}

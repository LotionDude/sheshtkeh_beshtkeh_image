// Node 24+, no npm install needed. Creates a disposable guest and private room.
import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { createHash, randomBytes, randomUUID } from 'node:crypto'

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:8094')
// Optional local harness: emulate an HTTPS router from a trusted proxy network.
// This checks forwarded-header handling, not actual TLS, DNS or OpenShift admission.
const proxyOrigin = process.env.SMOKE_PROXY_ORIGIN ? new URL(process.env.SMOKE_PROXY_ORIGIN) : null
if (proxyOrigin) assert.equal(proxyOrigin.protocol, 'https:')
const originHeaders = proxyOrigin ? { Origin: proxyOrigin.origin, Host: proxyOrigin.host,
  'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '203.0.113.10' } : { Origin: base.origin }
const cookies = new Map()
// Native HTTP preserves a different public Host in the local proxy harness.
function proxyFetch(url, options) {
  return new Promise((resolve, reject) => {
    const headers = { ...options.headers }
    let body = options.body
    if (body instanceof URLSearchParams) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8'
      body = body.toString()
    }
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url,
      { method: options.method ?? 'GET', headers, signal: options.signal }, response => {
        const chunks = [], responseHeaders = new Headers()
        for (let i = 0; i < response.rawHeaders.length; i += 2) responseHeaders.append(response.rawHeaders[i], response.rawHeaders[i + 1])
        response.on('data', chunk => chunks.push(chunk))
        response.on('error', reject)
        response.on('end', () => resolve(new Response(response.statusCode === 204 ? null : Buffer.concat(chunks), { status: response.statusCode, headers: responseHeaders })))
      })
    req.on('error', reject)
    req.end(body)
  })
}
async function request(path, options = {}) {
  const response = await (proxyOrigin ? proxyFetch : fetch)(new URL(path, base), {
    ...options, signal: AbortSignal.timeout(15_000),
    headers: { ...originHeaders, Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '), ...options.headers },
  })
  for (const cookie of response.headers.getSetCookie()) {
    if (proxyOrigin || base.protocol === 'https:') assert.match(cookie, /;\s*Secure(?:;|$)/i, 'HTTPS cookies must be Secure')
    const [pair] = cookie.split(';'), index = pair.indexOf('=')
    cookies.set(pair.slice(0, index), pair.slice(index + 1))
  }
  return response
}
async function json(path, options) {
  const response = await request(path, options)
  assert.equal(response.status, 200, `${path}: ${response.status} ${await response.clone().text()}`)
  return response.json()
}
function socket(path) {
  return new Promise((resolve, reject) => {
    const key = randomBytes(16).toString('base64')
    const req = (base.protocol === 'https:' ? httpsRequest : httpRequest)(new URL(path, base), { headers: {
      ...originHeaders, Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key,
    } })
    const timer = setTimeout(() => { req.destroy(); reject(new Error(`${path}: WebSocket timeout`)) }, 10_000)
    req.on('upgrade', (response, connection, head) => {
      try {
        assert.equal(response.statusCode, 101)
        assert.equal(response.headers['sec-websocket-accept'], createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64'))
        // Wait for a complete initial server text frame, not merely an upgrade response.
        let buffer = head
        const inspect = () => {
          if (buffer.length < 2) return
          assert.equal(buffer[0] & 0x0f, 1, 'expected a WebSocket text frame')
          let length = buffer[1] & 0x7f, offset = 2
          if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4 }
          if (length === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); offset = 10 }
          if (buffer.length < offset + length) return
          const message = JSON.parse(buffer.subarray(offset, offset + length).toString())
          assert.equal(message.schemaVersion, 1)
          assert.ok(message.type === 'snapshot' || message.type === 'matchmaking', `unexpected initial frame: ${message.type}`)
          clearTimeout(timer); connection.destroy(); resolve()
        }
        connection.on('error', error => { clearTimeout(timer); reject(error) })
        connection.on('data', chunk => {
          try { buffer = Buffer.concat([buffer, chunk]); inspect() }
          catch (error) { clearTimeout(timer); connection.destroy(); reject(error) }
        })
        inspect()
      } catch (error) { clearTimeout(timer); connection.destroy(); reject(error) }
    })
    req.on('response', response => { clearTimeout(timer); response.resume(); reject(new Error(`${path}: expected 101, got ${response.statusCode}`)) })
    req.on('error', error => { clearTimeout(timer); reject(error) })
    req.end()
  })
}

if (proxyOrigin) {
  const plain = await fetch(new URL('/api/v1/session', base), { signal: AbortSignal.timeout(15_000) })
  assert.equal(plain.status, 426, 'strict production APIs must reject non-TLS requests without trusted forwarding')
}
for (const path of ['/actuator/health', '/actuator/health/liveness', '/actuator/health/readiness']) {
  assert.equal((await json(path)).status, 'UP')
}
const html = await (await request('/')).text()
assert.match(html, /<div id="root">/)
for (const path of ['/local', '/ai', '/ai/results', '/online', '/private/join/ABC234', '/rooms/ABC234/play', '/rooms/ABC234/results', '/admin', '/admin/storage']) {
  const response = await request(path)
  assert.equal(response.status, 200, path)
  assert.equal(await response.text(), html, `SPA refresh at ${path}`)
}
const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(match => match[1])
assert.ok(assets.length > 0)
for (const path of assets) {
  const response = await request(path)
  assert.equal(response.status, 200, path)
  assert.doesNotMatch(response.headers.get('content-type') ?? '', /text\/html/)
  assert.ok((await response.arrayBuffer()).byteLength > 0)
}
assert.equal((await request('/api/not-a-route')).status, 404)
assert.equal((await request('/actuator/env')).status, 404)
assert.equal((await request('/api/admin/status')).status, 401)
const session = await json('/api/v1/session')
assert.ok(session.csrfToken)
await json('/api/v1/profile', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': session.csrfToken }, body: JSON.stringify({ username: 'Beta Smoke' }) })
const room = await json('/api/v1/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': session.csrfToken }, body: JSON.stringify({ commandId: randomUUID() }) })
assert.ok(room.code)
await socket(`/ws/private/${room.code}`)
await socket('/ws/matchmaking')
const admin = await json('/api/admin/session')
assert.equal(admin.authenticated, false)
if (process.env.SMOKE_ADMIN_PASSWORD) {
  assert.equal(admin.enabled, true)
  let csrf = await json('/api/admin/csrf')
  const login = await request('/api/admin/login', { method: 'POST', headers: { [csrf.headerName]: csrf.token }, body: new URLSearchParams({ username: process.env.SMOKE_ADMIN_USERNAME ?? 'admin', password: process.env.SMOKE_ADMIN_PASSWORD }) })
  assert.equal(login.status, 204)
  assert.equal((await json('/api/admin/session')).authenticated, true)
  await json('/api/admin/status')
  csrf = await json('/api/admin/csrf')
  assert.equal((await request('/api/admin/logout', { method: 'POST', headers: { [csrf.headerName]: csrf.token } })).status, 204)
  assert.equal((await request('/api/admin/status')).status, 401)
} else {
  console.log('Admin form/session reachable; credential login skipped (set SMOKE_ADMIN_PASSWORD to exercise it).')
}
console.log(`PASS ${base.origin}: health, frontend/assets, SPA refreshes, API, guest/profile/room, private + matchmaking WebSocket frames, Admin access controls.`)

import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { onRequestPost } from '../../../functions/api/feedback'
import type { D1Database, D1PreparedStatement } from '../edge'

// 运行端点发出的真实 SQL，而非用预设的 count/changes 掩盖并发窗口。
const databases: DatabaseSync[] = []
afterEach(() => { databases.splice(0).forEach((db) => db.close()); vi.useRealTimers() })
function database() {
  const sql = new DatabaseSync(':memory:')
  databases.push(sql)
  sql.exec(readFileSync('db/schema.sql', 'utf8'))
  const db: D1Database = {
    prepare(query) {
      let values: (string | number | null)[] = []
      const statement: D1PreparedStatement = {
        bind(...args) { values = args as typeof values; return statement },
        async first<T>() {
          const row = sql.prepare(query).get(...values) ?? null
          // D1 读请求有网络延迟，返回快照前让其它并发请求也完成读取。
          await new Promise((resolve) => setTimeout(resolve, 0))
          return row as T | null
        },
        async all<T>() { return { results: sql.prepare(query).all(...values) as T[] } },
        async run() { return { meta: { changes: Number(sql.prepare(query).run(...values).changes) } } },
      }
      return statement
    },
  }
  return { db, sql }
}
function request(body: unknown = { kind: 'note', body: '端点测试', locale: 'zh' }) {
  return new Request('https://insect-world.test/api/feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1' },
    body: JSON.stringify(body),
  })
}

describe('反馈端点与真实 SQLite', () => {
  const requestId = '550e8400-e29b-41d4-a716-446655440000'
  const submission = { kind: 'note', body: '重试应只收一条', locale: 'zh', requestId }
  it('同一提交的20个并发重试均确认收件，但只写一条', async () => {
    const { db, sql } = database()
    const env = { DB: db, FEEDBACK_SALT: 'test-salt' }
    const responses = await Promise.all(Array.from({ length: 20 }, () => onRequestPost({ request: request(submission), env })))
    expect(responses.every(response => response.status === 200)).toBe(true)
    expect(sql.prepare('SELECT COUNT(*) AS n FROM messages').get()?.n).toBe(1)
  })
  it('额度用满后仍确认已收件的重试，不重复计数', async () => {
    const { db, sql } = database()
    const env = { DB: db, FEEDBACK_SALT: 'test-salt' }
    expect((await onRequestPost({ request: request(submission), env })).status).toBe(200)
    for (let i = 0; i < 4; i++) expect((await onRequestPost({ request: request(), env })).status).toBe(200)
    expect((await onRequestPost({ request: request(submission), env })).status).toBe(200)
    expect((await onRequestPost({ request: request(), env })).status).toBe(429)
    expect(sql.prepare('SELECT COUNT(*) AS n FROM messages').get()?.n).toBe(5)
  })
  it('跨日并更换网络的重试仍只确认原提交', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T23:59:59Z'))
    const { db, sql } = database()
    const env = { DB: db, FEEDBACK_SALT: 'test-salt' }
    await onRequestPost({ request: request(submission), env })
    vi.setSystemTime(new Date('2026-10-02T00:00:01Z'))
    const retry = request(submission)
    retry.headers.set('CF-Connecting-IP', '192.0.2.2')
    expect((await onRequestPost({ request: retry, env })).status).toBe(200)
    expect(sql.prepare('SELECT COUNT(*) AS n FROM messages').get()?.n).toBe(1)
  })
  it('不同内容并发使用同一标识时只有一条收件，另一条返回冲突', async () => {
    const { db, sql } = database()
    const env = { DB: db, FEEDBACK_SALT: 'test-salt' }
    const responses = await Promise.all([submission, { ...submission, body: '另一份草稿' }].map(body => onRequestPost({ request: request(body), env })))
    expect(responses.map(response => response.status).sort()).toEqual([200, 409])
    expect(sql.prepare('SELECT COUNT(*) AS n FROM messages').get()?.n).toBe(1)
  })
  it('旧库迁移保留已有留言，并允许重复执行完整 schema', () => {
    const sql = new DatabaseSync(':memory:')
    databases.push(sql)
    sql.exec(`CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, kind TEXT NOT NULL,
      species TEXT, part TEXT, body TEXT NOT NULL, email TEXT, locale TEXT NOT NULL,
      ip_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new'
    ); INSERT INTO messages (created_at, kind, body, locale, ip_hash, status)
       VALUES (123, 'note', '既有留言', 'zh', 'old-hash', 'hidden');`)
    const before = sql.prepare('SELECT * FROM messages').get()
    sql.exec(readFileSync('db/migrations/2026-10-01-feedback-request-id.sql', 'utf8'))
    sql.exec(readFileSync('db/schema.sql', 'utf8'))
    sql.exec(readFileSync('db/schema.sql', 'utf8'))
    expect(sql.prepare('SELECT * FROM messages').get()).toEqual({ ...before, request_id: null })
    expect(sql.prepare("SELECT name FROM pragma_index_list('messages') WHERE name = 'idx_messages_request_id' AND [unique] = 1").get()?.name).toBe('idx_messages_request_id')
  })
  it.each(['body', 'email', 'locale', 'kind', 'species', 'part'])('已使用标识不能用于不同的 %s', async (field) => {
    const { db, sql } = database()
    const env = { DB: db, FEEDBACK_SALT: 'test-salt' }
    await onRequestPost({ request: request(submission), env })
    const alternatives = { body: '另一条反馈', email: 'reader@example.test', locale: 'en', kind: 'wish', species: 'ant', part: 'head' }
    const response = await onRequestPost({ request: request({ ...submission, [field]: alternatives[field as keyof typeof alternatives] }), env })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ ok: false, error: 'request-conflict' })
    expect(sql.prepare('SELECT COUNT(*) AS n FROM messages').get()?.n).toBe(1)
  })
  it.each(['', 'not-a-uuid', 123, null, 'x'.repeat(100)])('无效提交标识 %j 不写库', async requestId => {
    const { db, sql } = database()
    const response = await onRequestPost({ request: request({ ...submission, requestId }), env: { DB: db, FEEDBACK_SALT: 'test-salt' } })
    expect(response.status).toBe(400)
    expect(sql.prepare('SELECT COUNT(*) AS n FROM messages').get()?.n).toBe(0)
  })
  it('20 个并发请求只能写入当天额度内的 5 条', async () => {
    const { db, sql } = database()
    const responses = await Promise.all(Array.from({ length: 20 }, () =>
      onRequestPost({ request: request(), env: { DB: db, FEEDBACK_SALT: 'test-salt' } }),
    ))
    expect(responses.filter((r) => r.status === 200)).toHaveLength(5)
    expect(responses.filter((r) => r.status === 429)).toHaveLength(15)
    expect(sql.prepare('SELECT COUNT(*) AS n FROM messages').get()?.n).toBe(5)
  })

  it('无效提交和蜜罐均不占用额度', async () => {
    const { db, sql } = database()
    const env = { DB: db, FEEDBACK_SALT: 'test-salt' }
    expect((await onRequestPost({ request: request({ kind: 'note', body: 'x' }), env })).status).toBe(400)
    expect((await onRequestPost({ request: request({ kind: 'note', body: '测试', website: 'bot' }), env })).status).toBe(200)
    expect(sql.prepare('SELECT COUNT(*) AS n FROM messages').get()?.n).toBe(0)
  })

  it.each([null, [], 'text', 1, true])('顶层非对象 %j 返回400且不写库', async (value) => {
    const { db, sql } = database()
    const response = await onRequestPost({ request: request(value), env: { DB: db, FEEDBACK_SALT: 'test-salt' } })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ ok: false, error: 'bad-json' })
    expect(sql.prepare('SELECT COUNT(*) AS n FROM messages').get()?.n).toBe(0)
  })

  it('超大 JSON 在写库前被拒绝，普通 500 字中文仍可提交', async () => {
    const { db, sql } = database()
    const env = { DB: db, FEEDBACK_SALT: 'test-salt' }
    const big = await onRequestPost({ request: request({ kind: 'note', body: '正常正文', padding: 'x'.repeat(8192) }), env })
    expect(big.status).toBe(413)
    expect(await big.json()).toEqual({ ok: false, error: 'too-large' })
    expect(sql.prepare('SELECT COUNT(*) AS n FROM messages').get()?.n).toBe(0)
    const valid = await onRequestPost({ request: request({ kind: 'note', body: '虫'.repeat(500) }), env })
    expect(valid.status).toBe(200)
    expect(sql.prepare('SELECT body FROM messages').get()?.body).toBe('虫'.repeat(500))
  })

})

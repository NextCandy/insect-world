import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { onRequestPost } from '../../../functions/api/feedback'
import type { D1Database, D1PreparedStatement } from '../edge'

// 运行端点发出的真实 SQL，而非用预设的 count/changes 掩盖并发窗口。
const databases: DatabaseSync[] = []
afterEach(() => databases.splice(0).forEach((db) => db.close()))
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

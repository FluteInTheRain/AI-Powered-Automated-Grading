import { afterEach, describe, expect, it, vi } from 'vitest'
import * as api from '../src/api.js'

const ok = (body) => ({ ok: true, type: 'basic', status: 200, json: async () => body })
const fail = (status, body) => ({ ok: false, type: 'basic', status, json: async () => body })

afterEach(() => vi.unstubAllGlobals())

describe('api client', () => {
  it('startAttempt posts the name to the right path', async () => {
    const f = vi.fn().mockResolvedValue(ok({ attempt_id: 'a', receipt_code: 'R' }))
    vi.stubGlobal('fetch', f)
    expect(await api.startAttempt('tok', 'An')).toEqual({ attempt_id: 'a', receipt_code: 'R' })
    const [path, init] = f.mock.calls[0]
    expect(path).toBe('/api/exam/tok/attempts')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ student_name: 'An' })
  })

  it('non-2xx throws the detail text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fail(403, { detail: 'This exam is closed' })))
    await expect(api.getExam('t')).rejects.toThrow('This exam is closed')
  })

  it('a non-JSON error body gives the friendly message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, type: 'basic', json: async () => { throw new Error('x') } }))
    await expect(api.getExam('t')).rejects.toThrow(/time\/resource limit or the server is busy/)
  })

  it('an opaque redirect (expired Access session) reloads the page and throws', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, type: 'opaqueredirect', status: 0 }))
    await expect(api.getMe()).rejects.toThrow('Session expired, reloading')
    expect(reload).toHaveBeenCalledOnce()
  })

  it('submitQuestion and runTests use the question paths with only the code', async () => {
    const f = vi.fn().mockResolvedValue(ok({}))
    vi.stubGlobal('fetch', f)
    await api.submitQuestion('t', 'a1', 'p1', 'CODE')
    await api.runTests('t', 'a1', 'p1', 'CODE')
    expect(f.mock.calls[0][0]).toBe('/api/exam/t/attempts/a1/questions/p1/submit')
    expect(f.mock.calls[1][0]).toBe('/api/exam/t/attempts/a1/questions/p1/run')
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ code: 'CODE' })
  })

  it('updateDeadline patches the exam with the deadline key', async () => {
    const f = vi.fn().mockResolvedValue(ok({}))
    vi.stubGlobal('fetch', f)
    await api.updateDeadline('e1', null)
    expect(f.mock.calls[0][0]).toBe('/api/teacher/exams/e1')
    expect(f.mock.calls[0][1].method).toBe('PATCH')
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ deadline: null })
  })
})

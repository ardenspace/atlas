import type { Budget, Doc, DocMeta, Message, Project, Thread, ThreadMeta } from '../api/types'

const TS = '2026-07-24 00:00:00'

export function makeProject(over: Partial<Project> = {}): Project {
  return { id: 1, slug: 'p', name: 'P', brief: '', created_at: TS, ...over }
}

export function makeDocMeta(over: Partial<DocMeta> = {}): DocMeta {
  return { id: 1, kind: 'note', title: '메모', created_at: TS, updated_at: TS, ...over }
}

export function makeDoc(over: Partial<Doc> = {}): Doc {
  return { ...makeDocMeta(), project_id: 1, content: '', ...over }
}

export function makeThreadMeta(over: Partial<ThreadMeta> = {}): ThreadMeta {
  return { id: 1, title: '스레드', archived: 0, created_at: TS, ...over }
}

export function makeThread(over: Partial<Thread> = {}): Thread {
  return { ...makeThreadMeta(), project_id: 1, ...over }
}

export function makeMessage(over: Partial<Message> = {}): Message {
  return { id: 1, role: 'user', content: '안녕', created_at: TS, ...over }
}

export function makeBudget(over: Partial<Budget> = {}): Budget {
  return {
    limit: 8192,
    reserve: 1024,
    total: 1000,
    system_tokens: 800,
    history_tokens: 200,
    docs: [],
    exact: true,
    ...over,
  }
}

// server/main.py 응답 형태 그대로 — 필드 추가/이름 변경 금지 (API 계약 동결)
export type DocKind = 'idea' | 'research' | 'world' | 'note'

export interface Project {
  id: number
  slug: string
  name: string
  brief: string
  created_at: string
}

/** GET /api/projects/{id} 의 docs 항목 — content 없음 */
export interface DocMeta {
  id: number
  kind: DocKind
  title: string
  created_at: string
  updated_at: string
}

export interface Doc extends DocMeta {
  project_id: number
  content: string
}

/** GET /api/projects/{id} 의 threads 항목 — archived는 0/1 정수 */
export interface ThreadMeta {
  id: number
  title: string
  archived: number
  created_at: string
}

export interface Thread extends ThreadMeta {
  project_id: number
}

export interface Message {
  id: number
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface ProjectDetail {
  project: Project
  docs: DocMeta[]
  threads: ThreadMeta[]
}

export interface ThreadDetail {
  thread: Thread
  messages: Message[]
}

export interface BudgetDoc {
  id: number
  title: string
  tokens: number
}

/** total = system_tokens + history_tokens (문서 토큰은 system에 포함된 내역) */
export interface Budget {
  limit: number | null
  reserve: number
  total: number
  system_tokens: number
  history_tokens: number
  docs: BudgetDoc[]
  exact: boolean
}

export interface Health {
  ok: boolean
  gemma: boolean
}

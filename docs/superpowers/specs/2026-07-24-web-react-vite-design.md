# 계획 2 디자인 — atlas web/ React+Vite 재작성

날짜: 2026-07-24. 전제: main = 819ba66 (백엔드 v2 + 후속 A/B/C/P 완료, 62 tests).
API 계약: `docs/superpowers/plans/2026-07-23-backend-rework.md`의 "## 최종 API 표면" — **변경 금지**.
브레인스토밍에서 확정: 표준 소형 스택 · 3판 워크스페이스 · 정착 풀 오버레이 · vitest+RTL+MSW.

## 목표

구 바닐라 `web/`(v2 API와 불일치)을 React+Vite+TS strict UI로 전면 대체한다.
기능 범위: 마크다운 렌더링(문서+챗), 스레드 UI, 문서 체크박스+예산 게이지,
정착(settle) 검토·수정 플로우, 문서 편집기. 완성 후 FastAPI가 `web/dist`를 서빙한다.

## 1. 스택 & 프로젝트 구조

- `web/`을 통째로 Vite 프로젝트로 재구성. 구 바닐라 3파일(`index.html`, `app.js`, `style.css`) 삭제.
- 의존성 (표준 소형 스택 — 이 외 런타임 의존성 추가 금지):
  - React 19(Vite react-ts 템플릿 기본) + TypeScript **strict**
  - TanStack Query v5 — REST 상태·캐시·변이 후 무효화
  - react-markdown + remark-gfm — 문서·챗 assistant 메시지 렌더
  - 순수 CSS — 기존 다크 팔레트(`--bg #14151a`, `--panel #1d1f26`, `--line #2c2f3a`,
    `--text #e8e8ea`, `--dim #8b8e98`, `--accent #6ea8fe`) 계승. 컴포넌트 라이브러리 없음.
  - 라우터 없음 — 선택 상태(selectedProject/selectedThread) 기반 화면 전환.
- dev: Vite 포트 **5173** 고정, `/api` → `http://localhost:8787` 프록시.
  8080(Gemma)은 어떤 설정에서도 참조하지 않는다.
- prod: `vite build` → `web/dist`. `server/main.py`의 기존 `/static`(구 web/) 마운트를
  `web/dist` 서빙으로 교체 — `/`에서 `index.html`, 애셋 경로 서빙.
  **이것이 유일한 서버 수정이며 API 계약은 건드리지 않는다.**
- `.gitignore`: `node_modules/`, `web/dist/` 추가. 패키지 매니저: npm.

## 2. 화면 구성 (3판 워크스페이스)

```
+--------+------------------+----------+
| atlas  |  #스레드 제목      | 문서 □☑ |
|--------|                  |----------|
| 프로젝A |  [챗 메시지들]    | ☑ 기획   |
|  └스레드1|                 | ☑ 조사   |
|  └스레드2|                 | □ 세계관 |
| 프로젝B |                  |----------|
|        |                  | 예산 ▓▓░ |
|        |------------------| 71% used |
|        | [입력창____] 전송 | [정착]   |
+--------+------------------+----------+
```

- **Sidebar**: 프로젝트 목록(생성/이름변경/삭제) + 선택 프로젝트의 스레드 목록
  (생성/이름변경/보관 토글/삭제). gemma 상태 점 — `GET /api/health` 주기 폴링.
- **ChatPane**: 선택 스레드의 메시지 목록. assistant 메시지는 마크다운 렌더,
  user 메시지는 plain. SSE 스트리밍 중 커서 표시 + 중단 버튼.
  SSE `{error}` 이벤트는 채팅 내 인라인 에러로 표시. 413 응답은
  "문서 선택이나 스레드 길이를 줄이세요" 안내.
- **DocsPanel**: kind 뱃지(idea/research/world/note) 달린 문서 체크박스 목록.
  기본 전체 선택 — 전체 선택 상태면 요청에서 `doc_ids` 생략(=서버 기본 전체).
  예산 게이지(`GET /api/threads/{id}/budget`), [정착] 버튼, [+새 문서] 버튼.
- **오버레이 2종** (전체 화면 모달):
  - **DocEditor**: 문서 열람/편집. 제목·kind 선택·마크다운 본문 textarea,
    편집↔미리보기 토글. 저장=PUT, 신규=POST, 삭제=DELETE(확인 후).
  - **SettleOverlay**: ① 대상 선택 — 새 문서 or 기존 문서 갱신(`target_doc_id`)
    → ② `POST /settle` 초안 스트림 실시간 표시(중단 가능)
    → ③ 완료 후 에디터로 전환 — 본문 수정, 제목·kind 지정
    → ④ 저장(새 문서면 POST, 갱신이면 해당 문서에 PUT) or 버림(DB 무변경 — 서버는 원래 저장 안 함).

## 3. 데이터 흐름 & 에러 처리

- `web/src/api/` 레이어: API 표면 17개 엔드포인트의 타입드 클라이언트 + TanStack Query 훅.
  변이 성공 시 관련 쿼리 무효화(예: 문서 저장 → 프로젝트 상세·예산 무효화).
- **SSE 공용 파서 유틸 1개**: `fetch` + ReadableStream으로 `data:` 라인 파싱 →
  `{delta}` / `{error}` / `[DONE]` 콜백. 챗과 정착이 공유. 중단은 AbortController
  (챗 부분 저장은 서버 몫이므로 클라이언트는 그냥 끊는다).
- 예산 게이지 갱신 시점: 체크박스 변경 시 + 챗 스트림 종료 후. `exact: false`면 "추정" 표기.
- 문서 체크 상태: 스레드별 메모리 상태. 새로고침 시 전체 선택으로 리셋(단순 유지 — 영속화 안 함).

## 4. 테스트

- vitest + React Testing Library + **MSW**(SSE 스트림 응답 포함 전체 API 모킹).
- 커버 대상: SSE 파서 유닛, 챗 스트림 렌더(delta 누적·error 이벤트·중단),
  예산 게이지(갱신 시점·추정 표기·413 안내), 정착 저장 분기(POST vs PUT vs 버림),
  문서 CRUD + 체크박스→doc_ids 생략 규칙, 사이드바 CRUD.
- **NO LIVE 원칙**: 어느 테스트도 실 백엔드(8787)·llama-server(8080)를 치지 않는다.
  `npm test`가 프론트 커밋 게이트 (백엔드 SDD 루프의 `uv run pytest`와 동일 규율).

## 범위 밖

- 인증/원격 노출(터널은 별도 운영 문제), 반응형/모바일, 라우터·URL 딥링크,
  체크 상태 영속화, 다크/라이트 테마 전환(다크 고정), 계획 3(스킬 개정).

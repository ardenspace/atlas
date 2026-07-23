# atlas

마케팅 프로젝트용 사전 조사 + 세계관 빌딩 도구. 조사는 Claude(웹 접근 가능)가 하고, 세계관 대화는 로컬 Gemma 26B(llama-server)가 담당한다.

## 아키텍처

- `server/` — FastAPI 백엔드. SQLite(`data/atlas.db`, `ATLAS_DB`로 오버라이드)에
  프로젝트/문서/스레드/메시지 저장 (스키마 v2, `PRAGMA user_version`).
  Gemma 챗은 llama-server(:8080, `ATLAS_LLAMA_BASE`)의 OpenAI 호환 API로 프록시 (SSE 스트리밍).
- 문서 kind: `idea`(기획) / `research`(조사 리포트) / `world`(세계관 문서) / `note`(잡메모).
  채팅 요청의 `doc_ids`로 이번 대화에 물릴 문서를 선택한다 (생략 시 전체).
- 대화는 프로젝트당 다중 스레드. `POST /api/threads/{id}/settle`이 대화를 문서 초안으로
  정리해 스트리밍하고(저장은 클라이언트 몫), `GET /api/threads/{id}/budget`이 컨텍스트
  예산을 보고한다 (llama `/tokenize`·`/props` 기반, 서버 부재 시 추정치).
- `web/` — 구 바닐라 UI (v2 API와 불일치, React+Vite로 대체 예정 — 계획 2).
- 테스트: `uv run pytest` — llama-server를 절대 직접 치지 않는다 (모킹/MockTransport).

## 실행

```bash
uv run uvicorn server.main:app --host 0.0.0.0 --port 8787
```

## 포트 사용 규약

- atlas 서버: **8787**
- llama-server(Gemma): **8080** — 이 프로젝트가 소유하지 않음. 죽이거나 점유하지 말 것.
- 그 외 이 머신의 상시 점유 포트는 `~/.claude/CLAUDE.md` 참조.

## 제약

- Gemma는 웹 검색 불가. 조사류 작업은 반드시 research 스킬(Claude)로.
- 맥미니 GPU 48GB — llama.cpp 모델은 한 번에 하나만. 다른 모델을 띄우려고 Gemma를 내리면 atlas 챗이 죽는다.
- 원격 접속(다른 랩탑)은 터널(Cloudflare/Tailscale)로 붙일 예정 — 공개 인터넷에 8787을 직접 노출하지 말 것.

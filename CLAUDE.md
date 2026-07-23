# atlas

마케팅 프로젝트용 사전 조사 + 세계관 빌딩 도구. 조사는 Claude(웹 접근 가능)가 하고, 세계관 대화는 로컬 Gemma 26B(llama-server)가 담당한다.

## 아키텍처

- `server/` — FastAPI 백엔드. SQLite(`data/atlas.db`)에 프로젝트/문서/대화 저장. Gemma 챗은 llama-server(:8080)의 OpenAI 호환 API로 프록시 (SSE 스트리밍).
- `web/` — 바닐라 JS 정적 챗 UI. 빌드 단계 없음.
- `.claude/skills/research/` — 조사 스킬. 웹 조사 → 마크다운 리포트 → `POST /api/projects/{id}/docs` (kind=research).
- 문서 kind: `research`(조사 리포트) / `world`(세계관 문서) / `note`(기획 노트). 프로젝트의 모든 문서가 Gemma 시스템 프롬프트에 들어간다.

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

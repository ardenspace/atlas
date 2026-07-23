# atlas

마케팅 프로젝트를 시작할 때 필요한 **사전 조사**와 **콘텐츠 세계관 빌딩**을 한 곳에서.

- **조사**: Claude Code의 `research` 스킬이 시장 수요·경쟁·마케팅 각도를 웹 조사해 리포트로 등록
- **세계관 대화**: 로컬 Gemma 26B가 기획 메모 + 조사 리포트 + 세계관 문서를 컨텍스트로 물고 대화
- **재사용**: 프로젝트 단위로 문서와 대화가 쌓임 — 새 기획마다 프로젝트 하나 추가

## 시작

```bash
uv sync
uv run uvicorn server.main:app --host 0.0.0.0 --port 8787
# 브라우저에서 http://localhost:8787
```

전제: llama-server가 :8080에 Gemma를 띄워둔 상태여야 챗이 동작한다 (안 떠 있어도 프로젝트/문서 관리는 됨).

## 테스트

```bash
uv run pytest
```

llama-server 없이 전부 돈다 (Gemma 연동은 모킹).

## 조사 돌리기

Claude Code에서 이 리포 디렉토리를 열고:

```
/research <프로젝트 이름> <조사 주제>
```

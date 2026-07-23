---
name: research
description: 프로젝트의 시장 수요·경쟁·마케팅 각도를 웹 조사해서 리포트로 만들고 atlas 앱에 등록한다. "/research <프로젝트> <주제>" 또는 "이 프로젝트 사전 조사 해줘" 류 요청에 사용.
---

# atlas 조사 스킬

사용자가 지정한 프로젝트에 대해 웹 조사를 수행하고, 결과를 마크다운 리포트로 정리해 atlas 서버에 등록한다.

## 절차

1. **프로젝트 확인**: `curl -s http://127.0.0.1:8787/api/projects` 로 프로젝트 목록을 조회한다.
   사용자가 말한 프로젝트가 없으면 이름과 기획 메모(brief)를 받아 생성한다:
   `curl -s -X POST http://127.0.0.1:8787/api/projects -H 'Content-Type: application/json' -d '{"name": "...", "brief": "..."}'`

2. **조사 범위 합의**: 주제가 모호하면 조사 각도를 먼저 제안하고 확인받는다. 기본 각도:
   - 시장 수요: 타깃 오디언스 규모, 검색/트렌드 신호, 유사 콘텐츠의 성과 지표
   - 경쟁 지형: 주요 플레이어, 포화도, 비어 있는 포지션
   - 마케팅 각도: 훅이 되는 소구점, 플랫폼별 유통 전략, 차별화 포인트

3. **웹 조사**: WebSearch/WebFetch로 조사한다. 출처 URL을 리포트에 남긴다.
   숫자(구독자 수, 조회수, 시장 규모 등)는 출처와 시점을 함께 적는다.

4. **리포트 작성**: 아래 구조의 마크다운으로 정리한다.
   - 요약 (3~5문장 — 핵심 결론 먼저)
   - 시장 수요 / 경쟁 지형 / 마케팅 각도 (조사한 각도별 섹션)
   - 세계관 힌트: 조사 결과가 시사하는 콘텐츠 톤·세계관 방향 (Gemma와의 대화 씨앗)
   - 출처 목록

5. **등록**: 리포트를 임시 파일로 저장한 뒤 등록한다:
   ```bash
   python3 -c "
   import json, urllib.request, pathlib
   content = pathlib.Path('/tmp/report.md').read_text()
   body = json.dumps({'kind': 'research', 'title': '<리포트 제목>', 'content': content}).encode()
   req = urllib.request.Request('http://127.0.0.1:8787/api/projects/<ID>/docs', body, {'Content-Type': 'application/json'})
   print(urllib.request.urlopen(req).read().decode())
   "
   ```

6. **보고**: 리포트 요약과 함께 "atlas에서 이 프로젝트를 열면 Gemma가 이 리포트를 컨텍스트로 물고 세계관 대화를 시작할 수 있다"고 안내한다.

## 주의

- atlas 서버(:8787)가 안 떠 있으면 리포트를 `data/` 아래 md 파일로 저장해두고 서버 시작 방법을 안내한다.
- 리포트는 Gemma 26B의 시스템 프롬프트에 통째로 들어간다. 컨텍스트를 아끼기 위해 리포트 본문은 8천 자 이내로 유지한다. 원자료가 길면 요점 위주로 압축한다.

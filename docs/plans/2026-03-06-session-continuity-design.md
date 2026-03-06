# Session Continuity via Thread-Based Session Tracking

## Problem

현재 매 요청마다 새 Claude 세션을 생성하여, 같은 Slack 쓰레드 내에서도 대화가 이어지지 않음.
쓰레드 메시지를 컨텍스트로 주입하여 부분적으로 커버하지만, Claude 세션 자체의 연속성은 없음.

## Design

### Session ID 결정 우선순위

1. `session:new` → 새 세션 강제 생성
2. `session:<uuid>` → 명시적 세션 ID 지정 (다른 쓰레드 세션 이어가기)
3. 쓰레드 메시지에서 마지막 세션 ID 역추출 → 자동 이어가기
4. 위 모두 없으면 → 새 세션 생성

### Parser 확장

`ParsedMessage`에 `session: string | null` 필드 추가. `"new"` 또는 UUID 문자열.
기존 `repo:`, `model:`과 동일한 `session:\S+` 패턴으로 파싱.

### fetchThreadContext 변경

반환 타입을 `{ context: string; lastSessionId: string | null }`로 확장.
봇 메시지에서 `:link: \`<uuid>\`` 패턴을 정규식으로 매치하여 마지막 세션 ID 추출.
세션을 이어가는 경우 thread context 문자열은 비워서 중복 주입 방지.

### resolveSessionId

`maybeSessionId` 대체. 파서에서 받은 session 값, 쓰레드에서 추출한 세션 ID, config를 받아 최종 세션 ID 결정.

## 변경 범위

| 파일 | 변경 |
|------|------|
| `parser.ts` | `session` 필드 추가 |
| `handler.ts` | `resolveSessionId`, `fetchThreadContext` 반환 타입 확장, 세션 이어갈 때 context 생략 |
| `responder.ts` | 변경 없음 |
| `runner.ts` | 변경 없음 |
| `config.ts` | 변경 없음 |

# CCSlack

[English](./README.md)

Slack과 로컬 Claude Code CLI를 연결하는 브리지입니다. AI Assistant 사이드 패널에서 대화하거나 채널에서 `@봇이름`으로 멘션하면, 로컬 머신에서 `claude -p`를 서브프로세스로 실행하고 결과를 실시간 스트리밍으로 돌려줍니다. 로컬에 설정된 MCP 서버와 커넥터를 그대로 활용할 수 있습니다.

## 주요 기능

- AI Assistant 사이드 패널에서 직접 대화 (DM)
- Claude CLI 응답을 **실시간 스트리밍** (토큰 단위)
- 채널에서 `@봇이름` 멘션으로 사용 가능 (스레드 답변 + 리액션 상태)
- `repo:이름` 프리픽스로 작업할 레포지토리 지정
- 스레드 대화 컨텍스트 자동 포함 (멀티턴)
- **세션 연속성** — Slack에서 시작한 세션을 로컬에서 `claude --resume <id>`로 이어받기
- `--allowedTools`로 MCP 도구 권한 자동 승인
- 인메모리 작업 큐로 동시성 제어
- 허가된 사용자만 사용 가능 (Slack User ID 기반)

## 설정

### 1. Slack App 생성

[api.slack.com/apps](https://api.slack.com/apps)에서 **Create New App** > **From Scratch**를 클릭합니다.

1. 앱 이름(예: `ccbot`)과 워크스페이스를 선택합니다.
2. **Settings > Socket Mode**에서 Socket Mode를 켭니다.
3. **App-Level Token**을 생성합니다. 이름(예: `ccslack-socket`)을 입력하고 `connections:write` 스코프를 추가합니다. `xapp-...` 토큰을 복사합니다.
4. **Features > Agents & AI Apps**에서 기능을 **On**으로 활성화합니다. (`assistant:write` 스코프가 자동 추가됩니다.)
5. **Features > OAuth & Permissions > Scopes**에서 Bot Token Scopes를 추가합니다:
   - `assistant:write` (Agents & AI Apps 활성화 시 자동 추가)
   - `chat:write`
   - `im:history`
6. **Features > Event Subscriptions**에서 이벤트를 켜고, **Subscribe to bot events**에 다음을 추가합니다:
   - `assistant_thread_started`
   - `assistant_thread_context_changed`
   - `message.im`
7. **Features > App Home**에서 **Messages Tab**을 활성화하고, **"Allow users to send Slash commands and messages from the messages tab"**을 체크합니다.
8. **Install App**에서 워크스페이스에 설치합니다. `xoxb-...` Bot Token을 복사합니다.

### 2. CCSlack 설정

`~/.ccslack/config.json` 파일을 생성합니다:

```json
{
  "allowedUsers": ["U01ABCDEF12"],
  "maxConcurrency": 2,
  "taskTimeout": 300000,
  "defaultRepo": "my-project",
  "claudePath": "/usr/local/bin/claude",
  "repos": {
    "my-project": "/home/you/projects/my-project",
    "frontend": "/home/you/projects/frontend"
  },
  "allowedTools": ["Bash", "Read", "Edit", "Glob", "Grep", "Write", "mcp__*"],
  "suggestedPrompts": [
    { "title": "코드 리뷰", "message": "최근 변경사항을 리뷰해줘" },
    { "title": "버그 수정", "message": "테스트를 실행하고 실패하는 항목을 수정해줘" }
  ]
}
```

**Slack User ID 찾기:** Slack에서 프로필 사진 클릭 > **프로필** > 점 세 개 메뉴 > **멤버 ID 복사**

### 3. 환경 변수

프로젝트 루트에 `.env` 파일을 생성합니다:

```
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
```

### 4. 실행

```bash
bun install
bun dev
```

## 사용법

두 가지 방법으로 봇과 대화할 수 있습니다:

**1. AI Assistant 사이드 패널** — Slack에서 봇의 DM을 열면 사이드 패널이 나타납니다. 추천 프롬프트를 선택하거나 직접 메시지를 입력하세요. 실시간 스트리밍을 지원합니다.

**2. 채널 멘션** — 아무 채널에서나 봇을 멘션(`@봇이름`)하면 됩니다. 스레드로 답변하며, 처리 중에는 모래시계, 완료 시 체크/X 리액션이 표시됩니다.

```
@봇이름 repo:my-project 로그인 버그 수정해줘
@봇이름 repo:frontend auth 모듈 유닛 테스트 추가해줘
@봇이름 README 오타 수정해줘
```

- **`repo:<이름>`** — Claude를 실행할 레포지토리를 지정합니다. `config.repos`에서 이름을 찾습니다.
- `repo:` 프리픽스가 없으면 `defaultRepo`가 사용됩니다.
- 프리픽스 이후의 모든 텍스트가 Claude에 전달되는 프롬프트입니다.
- 같은 스레드에서 대화를 이어가면 이전 대화가 컨텍스트로 포함됩니다.

## 동작 방식

1. AI Assistant 사이드 패널(DM) 또는 채널에서 `@봇이름` 멘션으로 메시지를 보냅니다.
2. `allowedUsers`에 포함된 사용자인지 확인합니다.
3. 메시지에서 `repo:` 프리픽스와 프롬프트를 파싱합니다.
4. 작업이 인메모리 큐에 추가됩니다 (`maxConcurrency` 제한).
5. Claude CLI가 서브프로세스로 실행됩니다: `claude -p "<prompt>" --output-format stream-json --verbose --include-partial-messages --allowedTools ...`
6. 응답이 `chatStream` API를 통해 **실시간 스트리밍**으로 Slack에 표시됩니다.
7. 세션 ID가 표시되어 로컬에서 `claude --resume <id>`로 이어받을 수 있습니다.

## 설정 레퍼런스

| 필드 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `allowedUsers` | `string[]` | (필수) | 사용이 허가된 Slack User ID 목록 |
| `repos` | `Record<string, string>` | (필수) | 레포 단축 이름 → 로컬 경로 매핑 |
| `defaultRepo` | `string` | — | `repo:` 프리픽스 없을 때 사용할 기본 레포 |
| `claudePath` | `string` | `"claude"` | Claude CLI 바이너리 경로 |
| `maxConcurrency` | `number` | `2` | 최대 동시 Claude 프로세스 수 |
| `taskTimeout` | `number` | `300000` | 작업 타임아웃 (ms, 기본 5분) |
| `allowedTools` | `string[]` | `[]` | 권한 프롬프트 없이 자동 승인할 도구 목록 |
| `maxOutputTokens` | `number` | — | Claude 최대 출력 토큰 수 오버라이드 |
| `defaultModel` | `string` | — | 기본 모델 (예: `"sonnet"`, `"opus"`) |
| `enableSessionContinuity` | `boolean` | `true` | 세션 ID를 표시하여 로컬에서 이어받기 가능 |
| `suggestedPrompts` | `Array<{title, message}>` | `[]` | 사이드 패널에 표시할 추천 프롬프트 |

### `allowedTools` 예시

```json
"allowedTools": [
  "Bash",
  "Read",
  "Edit",
  "Glob",
  "Grep",
  "Write",
  "mcp__*",
  "Bash(npm run *)",
  "Read(/src/**/*.ts)"
]
```

자세한 문법은 [Claude Code 권한 문서](https://docs.anthropic.com/en/docs/claude-code/permissions)를 참고하세요.

## 기술 스택

- **런타임:** [Bun](https://bun.sh)
- **Slack SDK:** [@slack/bolt](https://tools.slack.dev/bolt-js) v4 (AI Assistant API + Socket Mode)
- **Claude CLI:** `claude -p` 서브프로세스 (stream-json 출력)
- **언어:** TypeScript

## 라이선스

[MIT](./LICENSE)

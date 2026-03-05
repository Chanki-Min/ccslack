# CCSlack

[한국어](./README.ko.md)

Bridge your Slack workspace to a local [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI. Chat with Claude through Slack's AI Assistant side panel, and it runs `claude -p` as a subprocess on your machine — with full access to your locally configured MCP servers, tools, and repos.

## Features

- **Real-time streaming** — Token-by-token responses via Slack's `chatStream` API
- **Slack AI Assistant** — Native side panel experience, no slash commands needed
- **Channel mentions** — `@ccbot` mentions with threaded replies and reaction status
- **Multi-repo** — Switch repos with `repo:name` prefix
- **Thread context** — Prior conversation automatically included for multi-turn dialogue
- **Session continuity** — Resume any Slack-initiated session locally with `claude --resume <id>`
- **Tool allowlist** — Auto-approve MCP tools via `--allowedTools`
- **Concurrency control** — In-memory task queue with configurable limits
- **Auth** — Slack User ID allowlist

## Setup

### 1. Create a Slack App

Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From Scratch**.

1. Enter an app name (e.g., `ccbot`) and select your workspace.
2. **Settings → Socket Mode** — Enable Socket Mode.
3. **Create an App-Level Token** — Name it (e.g., `ccslack-socket`), add the `connections:write` scope. Copy the `xapp-...` token.
4. **Features → Agents & AI Apps** — Toggle **On**. (`assistant:write` scope is added automatically.)
5. **Features → OAuth & Permissions → Scopes** — Add Bot Token Scopes:
   - `assistant:write` (auto-added from step 4)
   - `chat:write`
   - `im:history`
6. **Features → Event Subscriptions** — Enable events, then under **Subscribe to bot events** add:
   - `assistant_thread_started`
   - `assistant_thread_context_changed`
   - `message.im`
7. **Features → App Home** — Enable **Messages Tab** and check **"Allow users to send Slash commands and messages from the messages tab"**.
8. **Install App** — Install to your workspace. Copy the `xoxb-...` Bot Token.

### 2. Configure CCSlack

Create `~/.ccslack/config.json`:

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
    { "title": "Code review", "message": "Review recent changes" },
    { "title": "Fix bugs", "message": "Run tests and fix failures" }
  ]
}
```

**Finding your Slack User ID:** Click your profile picture in Slack → **Profile** → three-dot menu → **Copy member ID**.

### 3. Environment Variables

Create a `.env` file in the project root:

```
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
```

### 4. Run

```bash
bun install
bun dev
```

## Usage

Open the bot's DM in Slack — the AI Assistant side panel appears. Select a suggested prompt or type your own message.

```
repo:my-project fix the login bug
repo:frontend add unit tests for the auth module
fix the typo in README
```

- **`repo:<name>`** — Specifies which repo to run Claude in. Looks up `config.repos` by name.
- Without `repo:` prefix, `defaultRepo` is used.
- Everything after the prefix is the prompt sent to Claude.
- Continuing in the same thread includes prior conversation as context.

## How It Works

1. A message arrives via Slack AI Assistant side panel (or `@mention` in a channel).
2. The sender is checked against `allowedUsers`.
3. `repo:` prefix and prompt are parsed from the message.
4. The task is queued (bounded by `maxConcurrency`).
5. Claude CLI runs as a subprocess: `claude -p "<prompt>" --output-format stream-json --verbose --include-partial-messages --allowedTools ...`
6. Response streams token-by-token to Slack via `chatStream` API.
7. A session ID is posted so you can resume locally with `claude --resume <id>`.

## Config Reference

| Field | Type | Default | Description |
|---|---|---|---|
| `allowedUsers` | `string[]` | (required) | Slack User IDs allowed to use the bot |
| `repos` | `Record<string, string>` | (required) | Repo alias → local path mapping |
| `defaultRepo` | `string` | — | Default repo when `repo:` prefix is omitted |
| `claudePath` | `string` | `"claude"` | Path to Claude CLI binary |
| `maxConcurrency` | `number` | `2` | Max concurrent Claude processes |
| `taskTimeout` | `number` | `300000` | Task timeout in ms (default 5 min) |
| `allowedTools` | `string[]` | `[]` | Tools to auto-approve without permission prompts |
| `maxOutputTokens` | `number` | — | Override Claude's max output tokens |
| `defaultModel` | `string` | — | Default model (e.g., `"sonnet"`, `"opus"`) |
| `enableSessionContinuity` | `boolean` | `true` | Post session ID for local resume |
| `suggestedPrompts` | `Array<{title, message}>` | `[]` | Suggested prompts shown in the side panel |

### `allowedTools` Examples

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

See the [Claude Code permissions docs](https://docs.anthropic.com/en/docs/claude-code/permissions) for full syntax.

## Tech Stack

- **Runtime:** [Bun](https://bun.sh)
- **Slack SDK:** [@slack/bolt](https://tools.slack.dev/bolt-js) v4 (AI Assistant API + Socket Mode)
- **Claude CLI:** `claude -p` subprocess (stream-json output)
- **Language:** TypeScript

## License

[MIT](./LICENSE)

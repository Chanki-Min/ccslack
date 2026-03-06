# CCSlack

[한국어](./README.ko.md)

Bridge your Slack workspace to a local [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI. Chat with Claude through the AI Assistant side panel or `@mention` the bot in any channel — it runs `claude -p` as a subprocess on your machine with full access to your locally configured MCP servers, tools, and repos.

## Features

- **Real-time streaming** — Token-by-token responses via Slack's `chatStream` API
- **AI Assistant side panel** — Native side panel experience via DM, no slash commands needed
- **Channel mentions** — `@your-bot` in any channel for threaded replies with reaction status
- **Multi-repo** — Switch repos with `repo:name` prefix
- **Thread context** — Prior conversation automatically included for multi-turn dialogue
- **Prompt templates** — Customizable prompts with global + per-repo override support
- **Session continuity** — Resume any Slack-initiated session locally with `claude --resume <id>`
- **Tool allowlist** — Auto-approve MCP tools via `--allowedTools`
- **Concurrency control** — In-memory task queue with configurable limits
- **Reaction cancel** — Add an `x` reaction to any bot-triggered message to cancel the running task
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
   - `reactions:read`
6. **Features → Event Subscriptions** — Enable events, then under **Subscribe to bot events** add:
   - `assistant_thread_started`
   - `assistant_thread_context_changed`
   - `message.im`
   - `reaction_added`
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
  "promptTemplate": "~/.ccslack/prompts/global.txt",
  "repos": {
    "my-project": "/home/you/projects/my-project",
    "frontend": {
      "path": "/home/you/projects/frontend",
      "promptTemplate": "~/.ccslack/prompts/frontend.txt"
    }
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

There are two ways to interact with the bot:

**1. AI Assistant side panel** — Open the bot's DM in Slack. The AI Assistant side panel appears with suggested prompts and real-time streaming.

**2. Channel mention** — Mention the bot by name (`@your-bot-name`) in any channel. The bot replies in a thread with reaction indicators (hourglass while processing, checkmark/cross when done).

```
@your-bot repo:my-project fix the login bug
@your-bot repo:frontend add unit tests for the auth module
@your-bot fix the typo in README
```

- **`repo:<name>`** — Specifies which repo to run Claude in. Looks up `config.repos` by name.
- Without `repo:` prefix, `defaultRepo` is used.
- Everything after the prefix is the prompt sent to Claude.
- Continuing in the same thread includes prior conversation as context.

## Prompt Templates

Customize prompts via external text files. Supports global templates and per-repo overrides.

### Variables

| Variable | Description |
|---|---|
| `{{prompt}}` | User's input message |
| `{{thread}}` | Thread conversation context (empty string if none) |
| `{{repo}}` | Repo name |
| `{{global}}` | Rendered global template (only meaningful in per-repo templates) |

### Global Template Example

`~/.ccslack/prompts/global.txt`:

```
You are a software engineering expert.

{{thread}}

User request:
{{prompt}}
```

### Per-Repo Override Example

`~/.ccslack/prompts/frontend.txt`:

```
You are a React/TypeScript frontend expert.
Current repo: {{repo}}

{{global}}
```

- Use `{{global}}` to insert the rendered global template at that position.
- Omit `{{global}}` to fully override the global template.
- When no template is configured, the built-in default (`{{thread}}{{prompt}}`) is used.

## How It Works

1. A message arrives via the AI Assistant side panel (DM) or `@mention` in a channel.
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
| `repos` | `Record<string, string \| object>` | (required) | Repo alias → path or `{ path, promptTemplate? }` |
| `defaultRepo` | `string` | — | Default repo when `repo:` prefix is omitted |
| `claudePath` | `string` | `"claude"` | Path to Claude CLI binary |
| `promptTemplate` | `string` | built-in default | Global prompt template file path |
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

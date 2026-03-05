# CCSlack Design — Slack-to-Local-Claude Bridge

## Overview

CCSlack is a Slack bot that bridges Slack messages to a local Claude Code CLI instance. When a user mentions the bot in Slack, it runs `claude --print` as a subprocess on the local machine, leveraging all locally configured MCP servers and connectors.

## Architecture

```
Slack (Socket Mode / WebSocket)
    ↓
CCSlack Bot (Bun + @slack/bolt)
    ↓ parse message, validate user, extract repo
Task Queue (in-memory, configurable concurrency)
    ↓
Claude CLI subprocess (`claude --print -p "..." --cwd <repo-path>`)
    ↓
Result formatter → Slack thread reply (summary) + DM (full output)
```

## Key Decisions

- **Socket Mode**: No public URL needed. WebSocket-based connection to Slack.
- **Claude CLI subprocess**: Reuses all local MCP/connector configs. `--print` mode for non-interactive execution.
- **Hybrid question handling**: `--print` mode prevents interactive questions. If Claude is uncertain, it includes assumptions in output. User can refine and re-request in thread.
- **User ID auth**: Only `allowedUsers` (Slack User IDs) can trigger the bot. All other mentions are silently ignored.

## Message Format

```
@ccbot repo:my-project fix this bug
@ccbot repo:~/projects/app add tests for auth module
@ccbot fix the typo  (uses defaultRepo)
```

Parsing rules:
- Extract `repo:<name-or-path>` from message
- Look up name in `config.repos` mapping, or use as direct path
- Remaining text (after removing repo: prefix) becomes the Claude prompt
- If no `repo:` specified, use `config.defaultRepo`

## Concurrency

- `maxConcurrency` config variable (default: 2)
- In-memory task queue
- When queue is full, reply in thread: "대기 중입니다 (앞에 N개 작업)"
- Each task runs as independent subprocess

## Response Strategy

- **Thread reply**: Summary — success/failure, changed files, PR link if created
- **DM**: Full Claude output (split into multiple messages if > 4000 chars)
- **Reactions**: ⏳ when started, ✅ on success, ❌ on failure

## Error Handling

- Unknown repo → thread reply listing available repos
- Claude CLI failure → thread reply with error + ❌ reaction
- Timeout → configurable `taskTimeout` (default: 5 min), kill process on exceed

## Configuration

File: `~/.ccslack/config.json`

```json
{
  "allowedUsers": ["U01ABCDEF12"],
  "maxConcurrency": 2,
  "taskTimeout": 300000,
  "defaultRepo": "my-project",
  "claudePath": "claude",
  "repos": {
    "my-project": "~/projects/my-project",
    "frontend": "~/projects/frontend"
  }
}
```

## Slack App Requirements

- **Socket Mode**: Enabled
- **Event Subscriptions**: `app_mention`
- **Bot Token Scopes**: `app_mentions:read`, `chat:write`, `im:write`, `reactions:write`
- **App-Level Token**: `connections:write` scope

## Tech Stack

- Runtime: Bun
- Language: TypeScript
- Slack SDK: @slack/bolt + @slack/socket-mode
- Claude: CLI subprocess (`claude --print`)

## Project Structure

```
ccslack/
├── src/
│   ├── index.ts          # Entry point — Bolt app init & Socket Mode start
│   ├── config.ts         # Load config from ~/.ccslack/config.json
│   ├── slack/
│   │   ├── handler.ts    # Mention event handler, message parsing
│   │   └── responder.ts  # Thread reply & DM sending
│   ├── claude/
│   │   └── runner.ts     # Claude CLI subprocess execution
│   └── queue/
│       └── taskQueue.ts  # In-memory queue with concurrency control
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

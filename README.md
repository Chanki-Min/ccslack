# CCSlack

Slack-to-Local-Claude Bridge. CCSlack is a Slack bot that bridges messages to a local Claude Code CLI instance. When you mention the bot in Slack, it runs `claude -p` as a subprocess on your local machine, with full access to your locally configured MCP servers and connectors.

## Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App** > **From Scratch**.
2. Enter an app name (e.g., `ccbot`) and select your workspace.
3. **Enable Socket Mode**: Go to **Settings > Socket Mode** and toggle it on.
4. **Create an App-Level Token**: Name it (e.g., `ccslack-socket`) and add the `connections:write` scope. Copy the `xapp-...` token.
5. **Add Bot Token Scopes**: Go to **OAuth & Permissions > Scopes** and add:
   - `app_mentions:read`
   - `chat:write`
   - `im:write`
   - `reactions:write`
6. **Enable Event Subscriptions**: Go to **Event Subscriptions**, toggle on, and under **Subscribe to bot events** add `app_mention`.
7. **Install to Workspace**: Go to **Install App** and click **Install to Workspace**. Copy the `xoxb-...` Bot Token.

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
    "my-project": "/Users/you/projects/my-project",
    "frontend": "/Users/you/projects/frontend"
  }
}
```

**Fields:**

- `allowedUsers` -- Slack User IDs authorized to use the bot. All other mentions are silently ignored.
- `repos` -- A mapping of short names to local directory paths.
- `defaultRepo` -- The repo name used when no `repo:` prefix is specified in the message.
- `claudePath` -- Absolute path to the `claude` CLI binary (defaults to `"claude"` on PATH).
- `maxConcurrency` -- Maximum number of Claude subprocesses to run in parallel (default: `2`).
- `taskTimeout` -- Maximum time per task in milliseconds before the process is killed (default: `300000` = 5 min).

**Finding your Slack User ID:** In Slack, click on your profile picture > **Profile**. Click the three-dot menu and select **Copy member ID**.

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

Mention the bot in any channel it has been invited to:

```
@ccbot repo:my-project fix the login bug
@ccbot repo:frontend add unit tests for the auth module
@ccbot fix the typo in README
```

- **`repo:<name>`** -- Selects which repo to run Claude in. The name is looked up in `config.repos`. You can also use a direct path like `repo:~/projects/app`.
- If no `repo:` prefix is given, the `defaultRepo` from config is used.
- Everything after the `repo:` prefix (and bot mention) becomes the prompt sent to Claude.

## How It Works

1. You mention the bot in Slack with a prompt.
2. CCSlack validates the sender against `allowedUsers`.
3. The message is parsed to extract the `repo:` prefix and prompt text.
4. The task is added to an in-memory queue (respecting `maxConcurrency`).
5. Claude CLI runs as a subprocess: `claude -p "<prompt>" --cwd <repo-path>`.
6. The result is posted back as a thread reply (summary) and a DM (full output).
7. Reactions indicate status: hourglass when started, check mark on success, cross mark on failure.

## Configuration Reference

| Field | Type | Default | Description |
|---|---|---|---|
| `allowedUsers` | `string[]` | (required) | Slack User IDs authorized to use the bot |
| `repos` | `Record<string, string>` | (required) | Map of repo short names to local paths |
| `defaultRepo` | `string` | -- | Repo used when no `repo:` prefix is given |
| `claudePath` | `string` | `"claude"` | Path to the Claude CLI binary |
| `maxConcurrency` | `number` | `2` | Max parallel Claude subprocesses |
| `taskTimeout` | `number` | `300000` | Task timeout in ms (default 5 min) |

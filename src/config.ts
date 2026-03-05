import { readFileSync, existsSync } from "fs";

export interface CCSlackConfig {
  allowedUsers: string[];
  maxConcurrency: number;
  taskTimeout: number;
  defaultRepo?: string;
  claudePath: string;
  repos: Record<string, string>;
  allowedTools?: string[];
  suggestedPrompts?: Array<{ title: string; message: string }>;
  maxOutputTokens?: number;
  defaultModel?: string;
}

const DEFAULTS: Partial<CCSlackConfig> = {
  maxConcurrency: 2,
  taskTimeout: 300000,
  claudePath: "claude",
  allowedTools: [],
  suggestedPrompts: [],
  maxOutputTokens: 128000,
};

export function loadConfig(configPath: string): CCSlackConfig {
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const raw = JSON.parse(readFileSync(configPath, "utf-8"));

  const config: CCSlackConfig = {
    ...DEFAULTS,
    ...raw,
  } as CCSlackConfig;

  if (!config.allowedUsers || config.allowedUsers.length === 0) {
    throw new Error("allowedUsers must contain at least one Slack User ID");
  }

  return config;
}

export const DEFAULT_CONFIG_PATH = `${process.env.HOME}/.ccslack/config.json`;

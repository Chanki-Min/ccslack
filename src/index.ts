import { App } from "@slack/bolt";
import { loadConfig, DEFAULT_CONFIG_PATH } from "./config";
import { TaskQueue } from "./queue/taskQueue";
import { createHandler } from "./slack/handler";

const configPath = process.env.CCSLACK_CONFIG || DEFAULT_CONFIG_PATH;
const config = loadConfig(configPath);

console.log(`CCSlack starting...`);
console.log(`  Allowed users: ${config.allowedUsers.join(", ")}`);
console.log(`  Max concurrency: ${config.maxConcurrency}`);
console.log(`  Repos: ${Object.keys(config.repos).join(", ")}`);

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

const queue = new TaskQueue(config.maxConcurrency);
const handler = createHandler(config, queue);

app.event("app_mention", async ({ event, client }) => {
  try {
    await handler({ event, client });
  } catch (err) {
    console.error("Unhandled error in mention handler:", err);
  }
});

(async () => {
  await app.start();
  console.log("CCSlack bot is running!");
})();

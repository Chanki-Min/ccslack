import { App } from "@slack/bolt";
import { loadConfig, DEFAULT_CONFIG_PATH } from "./config";
import { TaskQueue } from "./queue/taskQueue";
import { createAssistant } from "./slack/handler";

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
const assistant = createAssistant(config, queue);
app.assistant(assistant);

(async () => {
  await app.start();
  console.log("CCSlack AI Assistant is running!");
})();

import { loadHostConfigFromEnv } from "./config";
import { start } from "./server";

const { view, api } = start(loadHostConfigFromEnv());

function shutdown(): void {
  view.close();
  api.close();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

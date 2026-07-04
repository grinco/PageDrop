import { loadHostConfigFromEnv } from "./config";
import { start } from "./server";

start(loadHostConfigFromEnv());

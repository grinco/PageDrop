import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PublishService } from "./core/publish-service.js";
import { AppsScriptPublisher } from "./adapters/google/apps-script-publisher.js";
import { PublisherClient } from "./adapters/google/publisher-client.js";
import { loadPublisherConfigFromEnv } from "./adapters/google/config.js";
import { registerTools } from "./mcp/tools.js";

async function main(): Promise<void> {
  const config = loadPublisherConfigFromEnv();
  const client = new PublisherClient(config.publisherUrl, config.secret);
  const publisher = new AppsScriptPublisher(client, { rendererBaseUrl: config.rendererBaseUrl });
  const service = new PublishService(publisher);

  const server = new McpServer({ name: "pagedrop", version: "0.1.0" });
  registerTools(server as unknown as Parameters<typeof registerTools>[0], service);

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("PageDrop failed to start:", err);
  process.exit(1);
});

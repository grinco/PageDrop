import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PublishService } from "./core/publish-service.js";
import { createPublisher } from "./adapters/google/create-publisher.js";
import { registerTools } from "./mcp/tools.js";

async function main(): Promise<void> {
  const service = new PublishService(createPublisher());

  const server = new McpServer({ name: "pagedrop", version: "0.1.0" });
  registerTools(server as unknown as Parameters<typeof registerTools>[0], service);

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("PageDrop failed to start:", err);
  process.exit(1);
});

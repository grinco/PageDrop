import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PublishService } from "./core/publish-service.js";
import { GoogleAdapter } from "./adapters/google/google-adapter.js";
import { GoogleDriveClient } from "./adapters/google/google-drive-client.js";
import { GoogleSlidesClient } from "./adapters/google/google-slides-client.js";
import { createOAuthClient, loadGoogleConfigFromEnv } from "./adapters/google/config.js";
import { registerTools } from "./mcp/tools.js";

async function main(): Promise<void> {
  const auth = createOAuthClient();
  const config = loadGoogleConfigFromEnv();
  const adapter = new GoogleAdapter(
    new GoogleDriveClient(auth),
    config,
    new GoogleSlidesClient(auth),
  );
  const service = new PublishService(adapter);

  const server = new McpServer({ name: "pagedrop", version: "0.1.0" });
  registerTools(server as unknown as Parameters<typeof registerTools>[0], service);

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("PageDrop failed to start:", err);
  process.exit(1);
});

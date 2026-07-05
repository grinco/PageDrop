import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PublishService } from "./core/publish-service.js";
import { DEFAULT_INLINE_IMAGE_LIMITS, type InlineImageLimits } from "./core/inline-images.js";
import { createPublisher } from "./adapters/google/create-publisher.js";
import { registerTools } from "./mcp/tools.js";

/** Parse a positive-integer env var, falling back to `fallback` when unset/invalid. */
function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Inline-image caps, tunable via env for parity with the other PAGEDROP_* knobs.
 * On the self-hosted backend these must stay within the host's request-body cap
 * (PAGEDROP_HOST_MAX_BODY_BYTES) and the API ingress `proxy-body-size`.
 */
function loadImageLimits(): InlineImageLimits {
  return {
    maxImages: numEnv("PAGEDROP_MAX_IMAGES", DEFAULT_INLINE_IMAGE_LIMITS.maxImages),
    maxImageBytes: numEnv("PAGEDROP_MAX_IMAGE_BYTES", DEFAULT_INLINE_IMAGE_LIMITS.maxImageBytes),
    maxTotalBytes: numEnv("PAGEDROP_MAX_TOTAL_IMAGE_BYTES", DEFAULT_INLINE_IMAGE_LIMITS.maxTotalBytes),
  };
}

async function main(): Promise<void> {
  const service = new PublishService(createPublisher(), loadImageLimits());

  const server = new McpServer({ name: "pagedrop", version: "0.1.0" });
  registerTools(server as unknown as Parameters<typeof registerTools>[0], service);

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("PageDrop failed to start:", err);
  process.exit(1);
});

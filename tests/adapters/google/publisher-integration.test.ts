import { describe, it, expect } from "vitest";
import { PublishService } from "../../../src/core/publish-service";
import { AppsScriptPublisher } from "../../../src/adapters/google/apps-script-publisher";
import { PublisherClient } from "../../../src/adapters/google/publisher-client";

/**
 * Wires the real PublishService → AppsScriptPublisher → PublisherClient chain
 * (the same objects index.ts composes) against an in-process fake fetch, so a
 * regression in any layer's contract surfaces here.
 */
describe("publisher chain integration", () => {
  it("publishes a page from markdown-free HTML through the whole chain to one HTTP call", async () => {
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    const fetchFn = async (url: string, init: { body: string }) => {
      requests.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ ok: true, data: { id: "file-42", sharing: "domain" } }), {
        status: 200,
      });
    };
    const client = new PublisherClient("https://pub/exec", "s3cret", fetchFn);
    const service = new PublishService(
      new AppsScriptPublisher(client, { rendererBaseUrl: "https://script.google.com/exec" }),
    );

    const res = await service.publishPage("Dashboard", "<h1>Hello</h1>");

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://pub/exec");
    expect(requests[0].body.secret).toBe("s3cret");
    expect(requests[0].body.action).toBe("publish");
    expect(requests[0].body.type).toBe("page");
    expect(String(requests[0].body.html)).toContain("<h1>Hello</h1>");
    expect(res.viewUrl).toBe("https://script.google.com/exec?id=file-42");
    expect(res.sharing).toBe("domain");
  });
});

import { z } from "zod";
import type { PublishResult } from "../core/types";
import type { PublishService } from "../core/publish-service";

export interface ToolHost {
  tool(
    name: string,
    description: string,
    schema: Record<string, unknown>,
    handler: (args: any) => Promise<{ content: { type: "text"; text: string }[] }>,
  ): void;
}

function text(msg: string) {
  return { content: [{ type: "text" as const, text: msg }] };
}

function describeResult(kind: string, title: string, r: PublishResult): string {
  const lines = [`Published ${kind}: "${title}".`];
  if (r.viewUrl) lines.push(`View: ${r.viewUrl}`);
  if (r.editUrl) lines.push(`Edit: ${r.editUrl}`);
  if (r.sharing === "domain") {
    lines.push("Shared with anyone in your organization who has the link.");
  } else if (r.sharing === "public") {
    lines.push("Shared publicly — anyone with the link can view.");
  }
  return lines.join("\n");
}

export function registerTools(host: ToolHost, service: PublishService): void {
  const tags = z.array(z.string()).optional();

  host.tool(
    "pagedrop_publish_doc",
    "Publish a Markdown document as a shareable, editable Google Doc.",
    { title: z.string(), markdown: z.string(), tags },
    async ({ title, markdown, tags }) =>
      text(describeResult("document", title, await service.publishDoc(title, markdown, tags))),
  );

  host.tool(
    "pagedrop_publish_page",
    "Publish a full HTML page rendered at a shareable Google Workspace URL.",
    { title: z.string(), html: z.string(), tags },
    async ({ title, html, tags }) =>
      text(describeResult("page", title, await service.publishPage(title, html, tags))),
  );

  host.tool(
    "pagedrop_publish_deck",
    "Publish an HTML/reveal.js presentation as a shareable rendered deck (with an optional native Google Slides copy).",
    { title: z.string(), html: z.string(), tags },
    async ({ title, html, tags }) =>
      text(describeResult("deck", title, await service.publishDeck(title, html, tags))),
  );

  host.tool(
    "pagedrop_republish",
    "Replace the HTML content of a previously published page or deck, keeping its URL.",
    { id: z.string(), html: z.string() },
    async ({ id, html }) => text(describeResult("update", id, await service.republish(id, html))),
  );

  host.tool(
    "pagedrop_list",
    "List everything published to PageDrop.",
    {},
    async () => {
      const refs = await service.list();
      if (refs.length === 0) return text("Nothing has been published yet.");
      return text(
        refs
          .map((r) => `- [${r.type}] ${r.title} — ${r.viewUrl ?? r.editUrl ?? "(no link)"}`)
          .join("\n"),
      );
    },
  );

  host.tool(
    "pagedrop_search",
    "Search published PageDrop artifacts by title or content.",
    { query: z.string() },
    async ({ query }) => {
      const refs = await service.search(query);
      if (refs.length === 0) return text(`No matches for "${query}".`);
      return text(
        refs
          .map((r) => `- [${r.type}] ${r.title} — ${r.viewUrl ?? r.editUrl ?? "(no link)"}`)
          .join("\n"),
      );
    },
  );
}

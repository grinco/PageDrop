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
  if (r.password) {
    lines.push(`Password: ${r.password} — share this separately from the link (shown only once).`);
  }
  return lines.join("\n");
}

export function registerTools(host: ToolHost, service: PublishService): void {
  const tags = z.array(z.string()).optional();
  const ttlSeconds = z
    .number()
    .optional()
    .describe("Self-hosted backend only: seconds until the artifact expires; 0 = never (overrides the server default).");
  const password = z
    .string()
    .optional()
    .describe("Self-hosted backend only: a password that gates viewing (min 8 chars).");
  const images = z
    .array(z.object({ id: z.string(), dataUri: z.string() }))
    .optional()
    .describe(
      'Base64 images to inline into the HTML (page/deck only). Reference each in the HTML as ' +
        '<img src="cid:ID">; dataUri is a self-contained "data:image/<type>;base64,<...>" string. ' +
        "Keeps the HTML small — pass photos here instead of pasting data URIs into the html body.",
    );

  host.tool(
    "pagedrop_publish_doc",
    "Publish a Markdown document as a shareable page. The Markdown is rendered to HTML for you — " +
      "use this for any Markdown/prose content (do NOT pass Markdown to publish_page/publish_deck, " +
      "which serve their input verbatim as HTML).",
    { title: z.string(), markdown: z.string(), tags, ttlSeconds, password },
    async ({ title, markdown, tags, ttlSeconds, password }) =>
      text(describeResult("document", title, await service.publishDoc(title, markdown, tags, { ttlSeconds, password }))),
  );

  host.tool(
    "pagedrop_publish_page",
    "Publish a full HTML page at a shareable URL. Content must be HTML — it is served verbatim, " +
      "not rendered. For Markdown, use pagedrop_publish_doc instead. To embed photos, pass them in " +
      'images and reference each as <img src="cid:ID"> rather than pasting base64 into the html.',
    { title: z.string(), html: z.string(), tags, ttlSeconds, password, images },
    async ({ title, html, tags, ttlSeconds, password, images }) =>
      text(describeResult("page", title, await service.publishPage(title, html, tags, { ttlSeconds, password, images }))),
  );

  host.tool(
    "pagedrop_publish_deck",
    "Publish an HTML/reveal.js presentation as a shareable rendered deck (with an optional native Google Slides copy). " +
      'To embed photos, pass them in images and reference each as <img src="cid:ID">.',
    { title: z.string(), html: z.string(), tags, ttlSeconds, password, images },
    async ({ title, html, tags, ttlSeconds, password, images }) =>
      text(describeResult("deck", title, await service.publishDeck(title, html, tags, { ttlSeconds, password, images }))),
  );

  host.tool(
    "pagedrop_republish",
    "Replace the content of a previously published artifact, keeping its URL. Provide content in the " +
      "artifact's original format — Markdown for a doc (re-rendered for you), HTML for a page or deck. " +
      'For a page/deck, embed photos via images referenced as <img src="cid:ID">.',
    { id: z.string(), html: z.string(), images },
    async ({ id, html, images }) => text(describeResult("update", id, await service.republish(id, html, images))),
  );

  host.tool(
    "pagedrop_delete",
    "Permanently delete a published PageDrop artifact by id (self-hosted backend).",
    { id: z.string() },
    async ({ id }) => {
      await service.delete(id);
      return text(`Deleted ${id}.`);
    },
  );

  host.tool(
    "pagedrop_protect",
    "Set or clear a viewing password and/or expiry on an existing artifact (self-hosted backend). " +
      "Pass null to clear a field; omit it to leave it unchanged. With no password on a default-protect " +
      "install, a memorable one is generated and returned.",
    {
      id: z.string(),
      password: z.string().nullable().optional().describe("String to set, null to clear, omit to leave unchanged."),
      ttlSeconds: z.number().nullable().optional().describe("Seconds until expiry; null/0 to clear, omit to leave unchanged."),
    },
    async ({ id, password, ttlSeconds }) => {
      const r = await service.setProtection(id, { password, ttlSeconds });
      const lines = [`Updated protection for ${id}.`];
      if (r.password) lines.push(`Password: ${r.password} — share this separately from the link (shown only once).`);
      return text(lines.join("\n"));
    },
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

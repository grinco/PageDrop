import { z } from "zod";
import { MIN_PASSWORD_LENGTH, type PublishResult } from "../core/types";
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
  // An empty string is rejected rather than accepted-and-ignored: the host reads
  // a missing password as "use the install default", which on a default-protect
  // install means generating one and locking the page.
  const TOO_SHORT = `password must be at least ${MIN_PASSWORD_LENGTH} characters — omit this field entirely if you want no password`;
  const password = z
    .string()
    .min(MIN_PASSWORD_LENGTH, TOO_SHORT)
    .optional()
    .describe(
      `Self-hosted backend only: a password viewers must enter to see the page (min ${MIN_PASSWORD_LENGTH} chars). ` +
        "Omit it for no password — do NOT pass an empty string. On a default-protect install, omitting it " +
        "means the server generates a memorable passphrase and returns it in the result. " +
        "A password can also be added, changed, or removed later with pagedrop_protect.",
    );
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
      "which serve their input verbatim as HTML). Optionally password-protect it here, or change " +
      "the password later with pagedrop_protect.",
    { title: z.string(), markdown: z.string(), tags, ttlSeconds, password },
    async ({ title, markdown, tags, ttlSeconds, password }) =>
      text(describeResult("document", title, await service.publishDoc(title, markdown, tags, { ttlSeconds, password }))),
  );

  host.tool(
    "pagedrop_publish_page",
    "Publish a full HTML page at a shareable URL. Content must be HTML — it is served verbatim, " +
      "not rendered. For Markdown, use pagedrop_publish_doc instead. To embed photos, pass them in " +
      'images and reference each as <img src="cid:ID"> rather than pasting base64 into the html. ' +
      "Optionally password-protect it here, or change the password later with pagedrop_protect.",
    { title: z.string(), html: z.string(), tags, ttlSeconds, password, images },
    async ({ title, html, tags, ttlSeconds, password, images }) =>
      text(describeResult("page", title, await service.publishPage(title, html, tags, { ttlSeconds, password, images }))),
  );

  host.tool(
    "pagedrop_publish_deck",
    "Publish an HTML/reveal.js presentation as a shareable rendered deck (with an optional native Google Slides copy). " +
      'To embed photos, pass them in images and reference each as <img src="cid:ID">. ' +
      "Optionally password-protect it here, or change the password later with pagedrop_protect.",
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
    "Change the password on an already-published PageDrop page, doc, or deck — set one, replace the " +
      "existing one, or remove it — and/or change its expiry. This is the tool for any request to " +
      "password-protect, lock, unlock, secure, change/reset the password of, un-protect, or set an " +
      "expiry/TTL on something already published to PageDrop (self-hosted backend). Pass null to " +
      "remove a field; omit it to leave it unchanged. On a default-protect install, omitting password " +
      "on a currently unprotected artifact generates a memorable one and returns it. Use pagedrop_list " +
      "first if you need the artifact's id.",
    {
      id: z.string().describe("Artifact id (not the full URL) — from pagedrop_list or a publish result."),
      password: z
        .string()
        .min(MIN_PASSWORD_LENGTH, TOO_SHORT)
        .nullable()
        .optional()
        .describe(
          `New password to require from viewers (min ${MIN_PASSWORD_LENGTH} chars); null removes password ` +
            "protection entirely; omit to leave it unchanged. An empty string is not accepted — use null to remove.",
        ),
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

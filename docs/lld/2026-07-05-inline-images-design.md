# PageDrop — Inline images in published HTML (Design)

Date: 2026-07-05
Status: Proposed (for review with the accompanying PR)
Author: Vadim (with Claude)

## Summary

Add an optional `images` parameter to the HTML-accepting publish operations
(`pagedrop_publish_page`, `pagedrop_publish_deck`, `pagedrop_republish`) so a
caller can supply base64 image payloads separately from the HTML body. PageDrop
inlines them into the stored HTML server-side, referenced by a stable
`<img src="cid:ID">` placeholder scheme.

## Motivation

Callers that assemble an HTML page with embedded photos otherwise have to paste
full `data:image/…;base64,…` URIs directly into the `html` string. For automated
publishers (LLM agents) that is impractical: a single downscaled photo is tens
of thousands of tokens of base64, which blows past model output limits and
context-truncation caps, so the image never survives into the `html` argument.

Separating the image payloads from the HTML body lets the producer keep the HTML
small and hand PageDrop the images as structured data. PageDrop already serves
page HTML verbatim, so a `data:` URI inlined server-side renders in any browser
with no viewer-side change.

## Non-goals

- Hosting images as separately-served static assets (would change the
  `Publisher` interface, both adapters, storage layout, and serving routes).
  This design keeps the single-`content`-string storage model unchanged; revisit
  asset hosting only if stored HTML blobs become a problem.
- Image transformation (resize/re-encode). Callers supply final bytes.

## API

Each of the three operations gains an optional parameter:

```ts
images?: Array<{ id: string; dataUri: string }>;
```

- `id`: `^[a-z0-9-]{1,64}$`, unique within the call.
- `dataUri`: `^data:image/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$`.
- HTML references an image as `<img src="cid:ID">` (single or double quotes).

`images` omitted or empty ⇒ behavior is byte-for-byte identical to today.

## Behavior

At the core layer (`src/core/publish-service.ts`), before handing `content` to
the `Publisher`:

1. Validate each entry (`id` shape + uniqueness, `dataUri` shape).
2. Enforce limits: per-image decoded size ≤ `MAX_IMAGE_BYTES` (default 2 MB),
   count ≤ `MAX_IMAGES` (default 20), total ≤ `MAX_TOTAL_BYTES` (default 24 MB).
3. Replace every `src="cid:ID"` / `src='cid:ID'` occurrence with
   `src="<dataUri>"`.
4. Every `images` entry must be referenced by at least one `cid:` occurrence, and
   every `cid:` occurrence must resolve to a supplied image — otherwise reject the
   publish with a clear error (never store dangling refs or unused payloads).
5. Store the resulting single `content` string via the existing
   `Publisher.publish` / `Publisher.update` path — no adapter changes.

## Structure

- New pure helper `src/core/inline-images.ts`:
  `inlineImages(html: string, images: ImageInput[], limits: Limits): string`
  (throws on validation failure). Unit-tested in `tests/core/inline-images.test.ts`
  over fixtures: happy path (1 and N images), missing ref, unused image, oversize,
  malformed `dataUri`, quote variants, `cid:` substring safety.
- `src/core/publish-service.ts`: thread an optional `images` through
  `publishPage` / `publishDeck` / `republish`, calling `inlineImages` when
  present.
- `src/mcp/tools.ts`: extend the zod input schemas for the three tools with the
  optional `images` array.
- `src/core/types.ts`: `ImageInput` type; `Limits` (or module constants).

No changes to `src/adapters/*`, `src/host`, or the served-page path.

## Testing

Core-layer unit tests as above. An MCP-level test asserting the tool schema
accepts `images` and that a page published with one image contains the data URI
and no residual `cid:` ref.

## Contract for consumers

Producers (e.g. the vornik daemon's media-handle mechanism) reference images by
`cid:<id>` in the HTML and pass matching `{ id, dataUri }` entries in `images`.
The `id` namespace is the producer's; PageDrop treats it as an opaque token.

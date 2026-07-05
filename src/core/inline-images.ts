// Inline base64 images into published HTML.
//
// Callers that assemble an HTML page with embedded photos can supply the image
// payloads separately from the HTML body and reference each by a stable
// `<img src="cid:ID">` placeholder. This module validates the payloads and
// replaces every `cid:` reference with the corresponding self-contained
// `data:` URI, returning a single HTML string suitable for verbatim serving.
//
// Keeping images out of the HTML string lets automated producers (e.g. LLM
// agents, which cannot carry tens of thousands of tokens of base64 through
// their output) hand PageDrop the images as structured data instead.

export interface ImageInput {
  id: string;
  dataUri: string;
}

export interface InlineImageLimits {
  maxImages: number;
  maxImageBytes: number;
  maxTotalBytes: number;
}

export const DEFAULT_INLINE_IMAGE_LIMITS: InlineImageLimits = {
  maxImages: 20,
  maxImageBytes: 2_000_000,
  maxTotalBytes: 24_000_000,
};

const ID_RE = /^[a-z0-9-]{1,64}$/;
const DATA_URI_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
// Matches src="cid:ID" / src='cid:ID' with a matching closing quote. Requiring
// the quote to immediately follow the id means an id can never partially match
// a longer id (e.g. "a" cannot match inside src="cid:ab").
const CID_REF_RE = /src=(["'])cid:([a-z0-9-]{1,64})\1/g;

// Decoded byte size of a base64 `data:` URI, from its base64 body length.
function decodedBytes(dataUri: string): number {
  const comma = dataUri.indexOf(",");
  const b64 = comma >= 0 ? dataUri.slice(comma + 1) : "";
  if (b64.length === 0) return 0;
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/**
 * Replace every `<img src="cid:ID">` reference in `html` with the matching
 * image's `data:` URI. `images` omitted or empty returns `html` unchanged.
 *
 * Throws on any validation failure: a malformed id or dataUri, an image over
 * the per-image size cap, too many images or too many total bytes, a `cid:`
 * reference with no matching image, or a supplied image that is never
 * referenced (so callers never store dangling refs or unused payloads).
 */
export function inlineImages(
  html: string,
  images: ImageInput[] | undefined,
  limits: InlineImageLimits = DEFAULT_INLINE_IMAGE_LIMITS,
): string {
  if (!images || images.length === 0) return html;

  if (images.length > limits.maxImages) {
    throw new Error(`too many images: ${images.length} (max ${limits.maxImages})`);
  }

  const byId = new Map<string, string>();
  let total = 0;
  for (const img of images) {
    if (!ID_RE.test(img.id)) {
      throw new Error(`invalid image id ${JSON.stringify(img.id)} (must match ${ID_RE})`);
    }
    if (byId.has(img.id)) {
      throw new Error(`duplicate image id ${JSON.stringify(img.id)}`);
    }
    if (!DATA_URI_RE.test(img.dataUri)) {
      throw new Error(`image ${JSON.stringify(img.id)} has a malformed data URI`);
    }
    const bytes = decodedBytes(img.dataUri);
    if (bytes > limits.maxImageBytes) {
      throw new Error(`image ${JSON.stringify(img.id)} is ${bytes} bytes (max ${limits.maxImageBytes})`);
    }
    total += bytes;
    byId.set(img.id, img.dataUri);
  }
  if (total > limits.maxTotalBytes) {
    throw new Error(`images total ${total} bytes (max ${limits.maxTotalBytes})`);
  }

  const used = new Set<string>();
  const missing = new Set<string>();
  // A data: URI's alphabet is [A-Za-z0-9+/=,:;] plus the mime slash — it never
  // contains a double quote, so wrapping it in src="..." is always safe.
  const out = html.replace(CID_REF_RE, (whole, _quote, id: string) => {
    const dataUri = byId.get(id);
    if (dataUri === undefined) {
      missing.add(id);
      return whole;
    }
    used.add(id);
    return `src="${dataUri}"`;
  });

  if (missing.size > 0) {
    throw new Error(`HTML references unknown image ids: ${[...missing].sort().join(", ")}`);
  }
  const unused = images.map((i) => i.id).filter((id) => !used.has(id));
  if (unused.length > 0) {
    throw new Error(`images not referenced by any cid: in the HTML: ${unused.sort().join(", ")}`);
  }

  return out;
}

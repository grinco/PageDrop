import type { ArtifactRef, ArtifactType, ProtectionUpdate, Publisher, PublishResult } from "./types";
import { inlineImages, DEFAULT_INLINE_IMAGE_LIMITS, type ImageInput, type InlineImageLimits } from "./inline-images";

/** Optional lifecycle/protection options for a publish call (self-hosted backend). */
export interface PublishOptions {
  ttlSeconds?: number;
  password?: string;
  /**
   * Base64 images to inline into the HTML body (page/deck only). Each is
   * referenced in the HTML as `<img src="cid:ID">`; see {@link inlineImages}.
   */
  images?: ImageInput[];
}

export class PublishService {
  constructor(
    private readonly publisher: Publisher,
    private readonly imageLimits: InlineImageLimits = DEFAULT_INLINE_IMAGE_LIMITS,
  ) {}

  private validate(title: string, content: string): void {
    if (!title.trim()) throw new Error("title is required");
    if (!content.trim()) throw new Error("content is required");
  }

  private async publishOfType(
    type: ArtifactType,
    title: string,
    content: string,
    tags?: string[],
    opts?: PublishOptions,
  ): Promise<PublishResult> {
    this.validate(title, content);
    // Docs are Markdown (rendered server-side); the cid: image contract applies
    // to verbatim HTML only, so images are inlined for page/deck only. Inlining
    // here (inside the async method) means a validation failure surfaces as a
    // rejected promise, consistent with validate().
    const finalContent =
      type === "doc" ? content : inlineImages(content, opts?.images, this.imageLimits);
    return this.publisher.publish(
      { type, title, content: finalContent, tags, ttlSeconds: opts?.ttlSeconds, password: opts?.password },
      "domain",
    );
  }

  publishDoc(title: string, markdown: string, tags?: string[], opts?: PublishOptions): Promise<PublishResult> {
    return this.publishOfType("doc", title, markdown, tags, opts);
  }
  publishPage(title: string, html: string, tags?: string[], opts?: PublishOptions): Promise<PublishResult> {
    return this.publishOfType("page", title, html, tags, opts);
  }
  publishDeck(title: string, html: string, tags?: string[], opts?: PublishOptions): Promise<PublishResult> {
    return this.publishOfType("deck", title, html, tags, opts);
  }

  async republish(id: string, content: string, images?: ImageInput[]): Promise<PublishResult> {
    if (!id.trim()) throw new Error("id is required");
    if (!content.trim()) throw new Error("content is required");
    return this.publisher.update(id, inlineImages(content, images, this.imageLimits));
  }

  async delete(id: string): Promise<void> {
    if (!id.trim()) throw new Error("id is required");
    return this.publisher.delete(id);
  }

  async setProtection(id: string, update: ProtectionUpdate): Promise<PublishResult> {
    if (!id.trim()) throw new Error("id is required");
    return this.publisher.setProtection(id, update);
  }

  list(): Promise<ArtifactRef[]> {
    return this.publisher.list();
  }

  async search(query: string): Promise<ArtifactRef[]> {
    if (!query.trim()) throw new Error("query is required");
    return this.publisher.search(query);
  }
}

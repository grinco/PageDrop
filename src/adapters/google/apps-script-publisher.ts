import type { Artifact, ArtifactRef, ArtifactType, Publisher, PublishResult, SharingScope } from "../../core/types";
import { renderMarkdown } from "../../core/markdown";
import { wrapHtmlDocument } from "../../core/html";
import { buildViewUrl } from "./config";
import type { PublisherRpc } from "./publisher-client";

export interface AppsScriptPublisherConfig {
  rendererBaseUrl: string;
}

interface RemoteItem {
  id: string;
  title: string;
  type?: ArtifactType;
}

/**
 * {@link Publisher} backed by the Apps Script publisher web app. All Google
 * writes/reads happen server-side (no GCP OAuth client); this class owns the
 * Markdown→HTML wrapping and composes renderer view URLs from returned ids.
 * Native Doc/Slides copies are deferred, so every artifact renders as HTML and
 * `editUrl` is always absent in this cut.
 */
export class AppsScriptPublisher implements Publisher {
  constructor(
    private readonly rpc: PublisherRpc,
    private readonly config: AppsScriptPublisherConfig,
  ) {}

  async publish(artifact: Artifact, scope: SharingScope = "domain"): Promise<PublishResult> {
    const html = this.toHtml(artifact.type, artifact.title, artifact.content);
    const data = await this.rpc.call("publish", {
      type: artifact.type,
      title: artifact.title,
      html,
      scope,
    });
    return {
      id: String(data.id),
      viewUrl: buildViewUrl(this.config.rendererBaseUrl, String(data.id)),
      sharing: data.sharing as PublishResult["sharing"],
    };
  }

  async update(id: string, content: string): Promise<PublishResult> {
    // No round-trip for the title; the server keeps the existing filename, and
    // the rendered tab title comes from that filename via the renderer.
    const html = wrapHtmlDocument(content, "");
    await this.rpc.call("update", { id, html });
    return { id, viewUrl: buildViewUrl(this.config.rendererBaseUrl, id) };
  }

  async list(): Promise<ArtifactRef[]> {
    const data = await this.rpc.call("list", {});
    return this.toRefs(data.items);
  }

  async search(query: string): Promise<ArtifactRef[]> {
    const data = await this.rpc.call("search", { query });
    return this.toRefs(data.items);
  }

  async setSharing(id: string, scope: SharingScope): Promise<void> {
    await this.rpc.call("setSharing", { id, scope });
  }

  private toHtml(type: ArtifactType, title: string, content: string): string {
    const inner = type === "doc" ? renderMarkdown(content) : content;
    return wrapHtmlDocument(inner, title);
  }

  private toRefs(items: unknown): ArtifactRef[] {
    if (!Array.isArray(items)) return [];
    return (items as RemoteItem[]).map((item) => ({
      id: item.id,
      title: item.title,
      type: item.type ?? "page",
      viewUrl: buildViewUrl(this.config.rendererBaseUrl, item.id),
    }));
  }
}

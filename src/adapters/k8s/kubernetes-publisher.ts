import type { Artifact, ArtifactRef, ArtifactType, ProtectionUpdate, Publisher, PublishResult, SharingScope } from "../../core/types";
import { renderMarkdown } from "../../core/markdown";
import { wrapHtmlDocument } from "../../core/html";
import type { HostClient, RemoteItem } from "./host-client";

export interface KubernetesPublisherConfig {
  baseUrl: string;
}

export class KubernetesPublisher implements Publisher {
  constructor(
    private readonly client: HostClient,
    private readonly config: KubernetesPublisherConfig,
  ) {}

  private viewUrl(id: string): string {
    return `${this.config.baseUrl.replace(/\/+$/, "")}/p/${id}`;
  }

  private toHtml(type: ArtifactType, title: string, content: string): string {
    const inner = type === "doc" ? renderMarkdown(content) : content;
    return wrapHtmlDocument(inner, title);
  }

  async publish(artifact: Artifact, _scope: SharingScope = "domain"): Promise<PublishResult> {
    const html = this.toHtml(artifact.type, artifact.title, artifact.content);
    const { id, password } = await this.client.publish({
      type: artifact.type,
      title: artifact.title,
      html,
      tags: artifact.tags,
      ttlSeconds: artifact.ttlSeconds,
      password: artifact.password,
    });
    return { id, viewUrl: this.viewUrl(id), sharing: "domain", ...(password ? { password } : {}) };
  }

  async update(id: string, content: string): Promise<PublishResult> {
    // Re-render exactly as publish does: a doc's content is Markdown and must be
    // converted; a page/deck is already HTML. The host stores bytes and does not
    // render, so the type-aware conversion has to happen here (as it does on
    // publish) — otherwise republishing a doc would serve raw Markdown.
    const item = await this.client.get(id);
    const inner = item.type === "doc" ? renderMarkdown(content) : content;
    await this.client.update(id, { html: wrapHtmlDocument(inner, item.title) });
    return { id, viewUrl: this.viewUrl(id) };
  }

  async delete(id: string): Promise<void> {
    await this.client.delete(id);
  }

  async setProtection(id: string, update: ProtectionUpdate): Promise<PublishResult> {
    const { password } = await this.client.setProtection(id, update);
    return { id, viewUrl: this.viewUrl(id), ...(password ? { password } : {}) };
  }

  async list(): Promise<ArtifactRef[]> {
    return (await this.client.list()).items.map((i) => this.toRef(i));
  }

  async search(query: string): Promise<ArtifactRef[]> {
    return (await this.client.search(query)).items.map((i) => this.toRef(i));
  }

  async setSharing(_id: string, scope: SharingScope): Promise<void> {
    if (scope !== "domain") throw new Error(`unsupported sharing scope for the k8s backend: ${scope}`);
    // no-op: viewing is uniformly SSO-gated org-wide.
  }

  private toRef(item: RemoteItem): ArtifactRef {
    return {
      id: item.id,
      title: item.title,
      type: (item.type as ArtifactType) ?? "page",
      viewUrl: this.viewUrl(item.id),
    };
  }
}

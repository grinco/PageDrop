import type { Artifact, ArtifactRef, ArtifactType, Publisher, PublishResult, SharingScope } from "../../core/types";
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
    const { id } = await this.client.publish({
      type: artifact.type,
      title: artifact.title,
      html,
      tags: artifact.tags,
    });
    return { id, viewUrl: this.viewUrl(id), sharing: "domain" };
  }

  async update(id: string, content: string): Promise<PublishResult> {
    await this.client.update(id, { html: wrapHtmlDocument(content, "") });
    return { id, viewUrl: this.viewUrl(id) };
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

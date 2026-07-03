import type { Artifact, ArtifactRef, Publisher, PublishResult, SharingScope } from "../../core/types";
import { renderMarkdown } from "../../core/markdown";
import { wrapHtmlDocument } from "../../core/html";
import { GOOGLE_DOC_MIME, type DriveClient } from "./drive-client";
import type { SlidesClient } from "./slides-client";
import { buildViewUrl, type GoogleConfig } from "./config";

export class GoogleAdapter implements Publisher {
  private folderId?: string;

  constructor(
    private readonly drive: DriveClient,
    private readonly config: GoogleConfig,
    private readonly slides?: SlidesClient,
  ) {}

  private async folder(): Promise<string> {
    if (!this.folderId) this.folderId = await this.drive.ensureFolder(this.config.folderName);
    return this.folderId;
  }

  async publish(artifact: Artifact, scope: SharingScope = "domain"): Promise<PublishResult> {
    const parent = await this.folder();
    if (artifact.type === "doc") {
      const html = wrapHtmlDocument(renderMarkdown(artifact.content), artifact.title);
      const file = await this.drive.uploadFile({
        name: artifact.title,
        mimeType: "text/html",
        content: html,
        parents: [parent],
        convertToGoogleDoc: true,
      });
      await this.applySharing(file.id, scope);
      return { id: file.id, editUrl: file.webViewLink };
    }

    if (artifact.type === "page") {
      const html = wrapHtmlDocument(artifact.content, artifact.title);
      const file = await this.drive.uploadFile({
        name: `${artifact.title}.html`,
        mimeType: "text/html",
        content: html,
        parents: [parent],
      });
      await this.applySharing(file.id, scope);
      return { id: file.id, viewUrl: buildViewUrl(this.config.rendererBaseUrl, file.id) };
    }

    throw new Error(`unsupported artifact type: ${artifact.type}`);
  }

  private async applySharing(id: string, scope: SharingScope): Promise<void> {
    if (scope === "domain") await this.drive.setDomainLinkSharing(id);
    else throw new Error(`sharing scope not supported in POC: ${scope}`);
  }

  // Implemented in later tasks:
  async update(_id: string, _content: string): Promise<PublishResult> {
    throw new Error("not implemented");
  }
  async list(): Promise<ArtifactRef[]> {
    throw new Error("not implemented");
  }
  async search(_query: string): Promise<ArtifactRef[]> {
    throw new Error("not implemented");
  }
  async setSharing(id: string, scope: SharingScope): Promise<void> {
    await this.applySharing(id, scope);
  }
}

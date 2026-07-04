import type { Artifact, ArtifactRef, ProtectionUpdate, Publisher, PublishResult, SharingScope } from "../../core/types";
import { renderMarkdown } from "../../core/markdown";
import { wrapHtmlDocument } from "../../core/html";
import { GOOGLE_DOC_MIME, type DriveClient, type DriveFile } from "./drive-client";
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
    if (artifact.ttlSeconds !== undefined || artifact.password !== undefined) {
      throw new Error("unsupported on the Google Drive backend: TTL and password protection require the self-hosted backend");
    }
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
      return {
        id: file.id,
        editUrl: file.webViewLink,
        sharing: this.config.domain ? "domain" : "public",
      };
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
      return {
        id: file.id,
        viewUrl: buildViewUrl(this.config.rendererBaseUrl, file.id),
        sharing: this.config.domain ? "domain" : "public",
      };
    }

    if (artifact.type === "deck") {
      const html = wrapHtmlDocument(artifact.content, artifact.title);
      const file = await this.drive.uploadFile({
        name: `${artifact.title}.html`,
        mimeType: "text/html",
        content: html,
        parents: [parent],
      });
      await this.applySharing(file.id, scope);
      const viewUrl = buildViewUrl(this.config.rendererBaseUrl, file.id);
      let editUrl: string | undefined;
      if (this.slides) {
        try {
          const deck = await this.slides.createDeck(artifact.title, viewUrl);
          editUrl = deck.webViewLink;
        } catch {
          editUrl = undefined; // best-effort; rendered deck is the deliverable
        }
      }
      return {
        id: file.id,
        viewUrl,
        editUrl,
        sharing: this.config.domain ? "domain" : "public",
      };
    }

    throw new Error(`unsupported artifact type: ${artifact.type}`);
  }

  private async applySharing(id: string, scope: SharingScope): Promise<void> {
    if (scope === "domain") await this.drive.setDomainLinkSharing(id);
    else throw new Error(`sharing scope not supported in POC: ${scope}`);
  }

  async update(id: string, content: string): Promise<PublishResult> {
    const file = await this.drive.getFile(id);
    if (file.mimeType !== "text/html") {
      throw new Error("republish supports HTML pages/decks only in the POC");
    }
    await this.drive.updateFileContent(id, wrapHtmlDocument(content, file.name), "text/html");
    return { id, viewUrl: buildViewUrl(this.config.rendererBaseUrl, id) };
  }

  async list(): Promise<ArtifactRef[]> {
    const parent = await this.folder();
    return (await this.drive.listFolder(parent)).map((f) => this.toRef(f));
  }

  async search(query: string): Promise<ArtifactRef[]> {
    const parent = await this.folder();
    return (await this.drive.searchFolder(parent, query)).map((f) => this.toRef(f));
  }

  private toRef(f: DriveFile): ArtifactRef {
    if (f.mimeType === GOOGLE_DOC_MIME) {
      return { id: f.id, title: f.name, type: "doc", editUrl: f.webViewLink };
    }
    return {
      id: f.id,
      title: f.name.replace(/\.html$/i, ""),
      type: "page",
      viewUrl: buildViewUrl(this.config.rendererBaseUrl, f.id),
    };
  }

  async setSharing(id: string, scope: SharingScope): Promise<void> {
    await this.applySharing(id, scope);
  }

  async delete(_id: string): Promise<void> {
    throw new Error("unsupported on the Google Drive backend: deletion requires the self-hosted backend");
  }

  async setProtection(_id: string, _update: ProtectionUpdate): Promise<PublishResult> {
    throw new Error("unsupported on the Google Drive backend: password/expiry require the self-hosted backend");
  }
}

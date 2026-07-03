import {
  GOOGLE_DOC_MIME,
  type DriveClient,
  type DriveFile,
  type UploadOptions,
} from "../../src/adapters/google/drive-client";

export class FakeDriveClient implements DriveClient {
  public shared = new Set<string>();
  private files = new Map<string, DriveFile & { content: string; parents: string[] }>();
  private seq = 0;

  async ensureFolder(name: string): Promise<string> {
    return `folder-${name}`;
  }

  async uploadFile(opts: UploadOptions): Promise<DriveFile> {
    this.seq += 1;
    const id = `file-${this.seq}`;
    const isDoc = opts.convertToGoogleDoc === true;
    const mimeType = isDoc ? GOOGLE_DOC_MIME : opts.mimeType;
    const webViewLink = isDoc
      ? `https://docs.google.com/document/d/${id}`
      : `https://drive.google.com/file/d/${id}`;
    const file = { id, name: opts.name, mimeType, webViewLink, content: opts.content, parents: opts.parents };
    this.files.set(id, file);
    return { id, name: file.name, mimeType, webViewLink };
  }

  async updateFileContent(id: string, content: string, mimeType: string): Promise<DriveFile> {
    const f = this.files.get(id);
    if (!f) throw new Error(`no such file: ${id}`);
    f.content = content;
    f.mimeType = mimeType;
    return { id: f.id, name: f.name, mimeType: f.mimeType, webViewLink: f.webViewLink };
  }

  async getFile(id: string): Promise<DriveFile> {
    const f = this.files.get(id);
    if (!f) throw new Error(`no such file: ${id}`);
    return { id: f.id, name: f.name, mimeType: f.mimeType, webViewLink: f.webViewLink };
  }

  async setDomainLinkSharing(id: string): Promise<void> {
    this.shared.add(id);
  }

  async listFolder(folderId: string): Promise<DriveFile[]> {
    return [...this.files.values()]
      .filter((f) => f.parents.includes(folderId))
      .map(({ id, name, mimeType, webViewLink }) => ({ id, name, mimeType, webViewLink }));
  }

  async searchFolder(folderId: string, query: string): Promise<DriveFile[]> {
    const q = query.toLowerCase();
    return (await this.listFolder(folderId)).filter((f) => f.name.toLowerCase().includes(q));
  }
}

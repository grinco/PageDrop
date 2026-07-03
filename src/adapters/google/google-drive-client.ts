import { google, type drive_v3 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { Readable } from "node:stream";
import {
  GOOGLE_DOC_MIME,
  type DriveClient,
  type DriveFile,
  type UploadOptions,
} from "./drive-client";

const FIELDS = "id, name, mimeType, webViewLink";

export function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function toDriveFile(f: drive_v3.Schema$File): DriveFile {
  return {
    id: f.id ?? "",
    name: f.name ?? "",
    mimeType: f.mimeType ?? "",
    webViewLink: f.webViewLink ?? "",
  };
}

export class GoogleDriveClient implements DriveClient {
  private readonly drive: drive_v3.Drive;

  private readonly domain?: string;

  constructor(auth: OAuth2Client, domain?: string) {
    this.drive = google.drive({ version: "v3", auth });
    this.domain = domain;
  }

  async ensureFolder(name: string): Promise<string> {
    const q = `name='${escapeDriveQueryValue(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const found = await this.drive.files.list({ q, fields: "files(id)", pageSize: 1 });
    const existing = found.data.files?.[0]?.id;
    if (existing) return existing;
    const created = await this.drive.files.create({
      requestBody: { name, mimeType: "application/vnd.google-apps.folder" },
      fields: "id",
    });
    if (!created.data.id) throw new Error("failed to create PageDrop folder");
    return created.data.id;
  }

  async uploadFile(opts: UploadOptions): Promise<DriveFile> {
    const res = await this.drive.files.create({
      requestBody: {
        name: opts.name,
        parents: opts.parents,
        ...(opts.convertToGoogleDoc ? { mimeType: GOOGLE_DOC_MIME } : {}),
      },
      media: { mimeType: opts.mimeType, body: Readable.from([opts.content]) },
      fields: FIELDS,
    });
    return toDriveFile(res.data);
  }

  async updateFileContent(id: string, content: string, mimeType: string): Promise<DriveFile> {
    const res = await this.drive.files.update({
      fileId: id,
      media: { mimeType, body: Readable.from([content]) },
      fields: FIELDS,
    });
    return toDriveFile(res.data);
  }

  async getFile(id: string): Promise<DriveFile> {
    const res = await this.drive.files.get({ fileId: id, fields: FIELDS });
    return toDriveFile(res.data);
  }

  async setDomainLinkSharing(id: string): Promise<void> {
    const domain = this.domain;
    await this.drive.permissions.create({
      fileId: id,
      requestBody: domain
        ? { type: "domain", role: "reader", domain, allowFileDiscovery: false }
        : { type: "anyone", role: "reader", allowFileDiscovery: false },
    });
  }

  async listFolder(folderId: string): Promise<DriveFile[]> {
    const res = await this.drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: `files(${FIELDS})`,
      pageSize: 100,
    });
    return (res.data.files ?? []).map(toDriveFile);
  }

  async searchFolder(folderId: string, query: string): Promise<DriveFile[]> {
    const escaped = escapeDriveQueryValue(query);
    const res = await this.drive.files.list({
      q: `'${folderId}' in parents and trashed=false and (name contains '${escaped}' or fullText contains '${escaped}')`,
      fields: `files(${FIELDS})`,
      pageSize: 100,
    });
    return (res.data.files ?? []).map(toDriveFile);
  }
}

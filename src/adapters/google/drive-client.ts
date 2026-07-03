export const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
}

export interface UploadOptions {
  name: string;
  mimeType: string;
  content: string;
  parents: string[];
  convertToGoogleDoc?: boolean;
}

export interface DriveClient {
  ensureFolder(name: string): Promise<string>;
  uploadFile(opts: UploadOptions): Promise<DriveFile>;
  updateFileContent(id: string, content: string, mimeType: string): Promise<DriveFile>;
  getFile(id: string): Promise<DriveFile>;
  setDomainLinkSharing(id: string): Promise<void>;
  listFolder(folderId: string): Promise<DriveFile[]>;
  searchFolder(folderId: string, query: string): Promise<DriveFile[]>;
}

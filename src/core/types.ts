export type ArtifactType = "doc" | "page" | "deck";
export type SharingScope = "domain" | "people" | "public";

/**
 * Minimum length for a user-supplied viewing password. Lives here so the MCP
 * tool schemas and the host's own validation agree on the number; the host
 * remains the authority (a direct API caller is checked there too).
 */
export const MIN_PASSWORD_LENGTH = 8;

export interface Artifact {
  type: ArtifactType;
  title: string;
  content: string; // Markdown for 'doc'; HTML for 'page'/'deck'
  tags?: string[];
  author?: string;
  ttlSeconds?: number; // self-hosted only: >0 sets expiry, 0 = never, omitted = server default
  password?: string; // self-hosted only: plaintext, hashed server-side
}

export interface PublishResult {
  id: string;
  viewUrl?: string;
  editUrl?: string;
  sharing?: "domain" | "public";
  password?: string; // present only when the server auto-generated one
}

/** Post-hoc protection change. null clears; a value sets; undefined leaves unchanged. */
export interface ProtectionUpdate {
  password?: string | null;
  ttlSeconds?: number | null;
}

export interface ArtifactRef {
  id: string;
  title: string;
  type: ArtifactType;
  viewUrl?: string;
  editUrl?: string;
  tags?: string[];
}

export interface Publisher {
  publish(artifact: Artifact, scope?: SharingScope): Promise<PublishResult>;
  update(id: string, content: string): Promise<PublishResult>;
  delete(id: string): Promise<void>;
  setProtection(id: string, update: ProtectionUpdate): Promise<PublishResult>;
  list(): Promise<ArtifactRef[]>;
  search(query: string): Promise<ArtifactRef[]>;
  setSharing(id: string, scope: SharingScope): Promise<void>;
}

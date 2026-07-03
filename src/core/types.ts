export type ArtifactType = "doc" | "page" | "deck";
export type SharingScope = "domain" | "people" | "public";

export interface Artifact {
  type: ArtifactType;
  title: string;
  content: string; // Markdown for 'doc'; HTML for 'page'/'deck'
  tags?: string[];
  author?: string;
}

export interface PublishResult {
  id: string;
  viewUrl?: string;
  editUrl?: string;
  sharing?: "domain" | "public";
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
  list(): Promise<ArtifactRef[]>;
  search(query: string): Promise<ArtifactRef[]>;
  setSharing(id: string, scope: SharingScope): Promise<void>;
}

import type { Artifact, ArtifactRef, ProtectionUpdate, Publisher, PublishResult, SharingScope } from "../../src/core/types";

export class FakePublisher implements Publisher {
  public published: { artifact: Artifact; scope: SharingScope }[] = [];
  public updated: { id: string; content: string }[] = [];
  public deleted: string[] = [];
  public protection: { id: string; update: ProtectionUpdate }[] = [];
  public sharing: PublishResult["sharing"] = "domain";
  /** When set, publish returns it as the auto-generated password. */
  public generatedPassword?: string;
  private seq = 0;

  async publish(artifact: Artifact, scope: SharingScope = "domain"): Promise<PublishResult> {
    this.seq += 1;
    this.published.push({ artifact, scope });
    return {
      id: `file-${this.seq}`,
      viewUrl: "https://view",
      editUrl: "https://edit",
      sharing: this.sharing,
      ...(this.generatedPassword ? { password: this.generatedPassword } : {}),
    };
  }
  async update(id: string, content: string): Promise<PublishResult> {
    this.updated.push({ id, content });
    return { id, viewUrl: "https://view" };
  }
  async delete(id: string): Promise<void> {
    this.deleted.push(id);
  }
  async setProtection(id: string, update: ProtectionUpdate): Promise<PublishResult> {
    this.protection.push({ id, update });
    return { id, viewUrl: "https://view", ...(this.generatedPassword ? { password: this.generatedPassword } : {}) };
  }
  async list(): Promise<ArtifactRef[]> {
    return [{ id: "file-1", title: "T", type: "doc" }];
  }
  async search(query: string): Promise<ArtifactRef[]> {
    return query === "hit" ? [{ id: "file-1", title: "T", type: "doc" }] : [];
  }
  async setSharing(): Promise<void> {}
}

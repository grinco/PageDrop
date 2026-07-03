import type { Artifact, ArtifactRef, Publisher, PublishResult, SharingScope } from "../../src/core/types";

export class FakePublisher implements Publisher {
  public published: { artifact: Artifact; scope: SharingScope }[] = [];
  public updated: { id: string; content: string }[] = [];
  public sharing: PublishResult["sharing"] = "domain";
  private seq = 0;

  async publish(artifact: Artifact, scope: SharingScope = "domain"): Promise<PublishResult> {
    this.seq += 1;
    this.published.push({ artifact, scope });
    return { id: `file-${this.seq}`, viewUrl: "https://view", editUrl: "https://edit", sharing: this.sharing };
  }
  async update(id: string, content: string): Promise<PublishResult> {
    this.updated.push({ id, content });
    return { id, viewUrl: "https://view" };
  }
  async list(): Promise<ArtifactRef[]> {
    return [{ id: "file-1", title: "T", type: "doc" }];
  }
  async search(query: string): Promise<ArtifactRef[]> {
    return query === "hit" ? [{ id: "file-1", title: "T", type: "doc" }] : [];
  }
  async setSharing(): Promise<void> {}
}

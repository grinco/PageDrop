import type { ArtifactRef, ArtifactType, Publisher, PublishResult } from "./types";

export class PublishService {
  constructor(private readonly publisher: Publisher) {}

  private validate(title: string, content: string): void {
    if (!title.trim()) throw new Error("title is required");
    if (!content.trim()) throw new Error("content is required");
  }

  private async publishOfType(
    type: ArtifactType,
    title: string,
    content: string,
    tags?: string[],
  ): Promise<PublishResult> {
    this.validate(title, content);
    return this.publisher.publish({ type, title, content, tags }, "domain");
  }

  publishDoc(title: string, markdown: string, tags?: string[]): Promise<PublishResult> {
    return this.publishOfType("doc", title, markdown, tags);
  }
  publishPage(title: string, html: string, tags?: string[]): Promise<PublishResult> {
    return this.publishOfType("page", title, html, tags);
  }
  publishDeck(title: string, html: string, tags?: string[]): Promise<PublishResult> {
    return this.publishOfType("deck", title, html, tags);
  }

  async republish(id: string, content: string): Promise<PublishResult> {
    if (!id.trim()) throw new Error("id is required");
    if (!content.trim()) throw new Error("content is required");
    return this.publisher.update(id, content);
  }

  list(): Promise<ArtifactRef[]> {
    return this.publisher.list();
  }

  async search(query: string): Promise<ArtifactRef[]> {
    if (!query.trim()) throw new Error("query is required");
    return this.publisher.search(query);
  }
}

import type { SlidesClient } from "../../src/adapters/google/slides-client";

export class FakeSlidesClient implements SlidesClient {
  public created: { title: string; viewUrl: string }[] = [];
  public shouldFail = false;
  private seq = 0;

  async createDeck(title: string, viewUrl: string): Promise<{ id: string; webViewLink: string }> {
    if (this.shouldFail) throw new Error("slides api unavailable");
    this.seq += 1;
    this.created.push({ title, viewUrl });
    const id = `slides-${this.seq}`;
    return { id, webViewLink: `https://docs.google.com/presentation/d/${id}` };
  }
}

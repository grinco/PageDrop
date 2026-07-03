export interface SlidesClient {
  createDeck(title: string, viewUrl: string): Promise<{ id: string; webViewLink: string }>;
}

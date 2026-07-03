import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { SlidesClient } from "./slides-client";

export class GoogleSlidesClient implements SlidesClient {
  private readonly auth: OAuth2Client;

  constructor(auth: OAuth2Client) {
    this.auth = auth;
  }

  async createDeck(title: string, viewUrl: string): Promise<{ id: string; webViewLink: string }> {
    const slides = google.slides({ version: "v1", auth: this.auth });
    const created = await slides.presentations.create({ requestBody: { title } });
    const id = created.data.presentationId;
    if (!id) throw new Error("failed to create presentation");

    const firstSlideId = created.data.slides?.[0]?.objectId;
    if (firstSlideId) {
      await slides.presentations.batchUpdate({
        presentationId: id,
        requestBody: {
          requests: [
            {
              createShape: {
                objectId: `note-${id}`,
                shapeType: "TEXT_BOX",
                elementProperties: {
                  pageObjectId: firstSlideId,
                  size: { width: { magnitude: 6000000, unit: "EMU" }, height: { magnitude: 800000, unit: "EMU" } },
                  transform: { scaleX: 1, scaleY: 1, translateX: 600000, translateY: 600000, unit: "EMU" },
                },
              },
            },
            {
              insertText: {
                objectId: `note-${id}`,
                text: `${title}\nRendered deck: ${viewUrl}`,
              },
            },
          ],
        },
      });
    }
    return { id, webViewLink: `https://docs.google.com/presentation/d/${id}` };
  }
}

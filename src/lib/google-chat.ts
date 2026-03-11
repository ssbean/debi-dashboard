import { logger } from "./logger";

export async function notifyGoogleChat(webhookUrl: string, message: string): Promise<void> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });
    if (!res.ok) {
      logger.warn(`Google Chat notification failed: HTTP ${res.status}`, "google-chat");
    } else {
      logger.info("Google Chat notification sent", "google-chat");
    }
  } catch (error) {
    logger.warn(`Google Chat notification error: ${String(error)}`, "google-chat");
  }
}

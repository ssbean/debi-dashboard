import { google } from "googleapis";
import { GmailError } from "./errors";
import { logger } from "./logger";

function getGmailClient(userEmail: string) {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
    ],
    subject: userEmail,
  });

  return google.gmail({ version: "v1", auth });
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const status = (error as { code?: number })?.code;
      if (status === 429 && i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 1000;
        logger.warn(`Gmail rate limited, retrying in ${delay}ms`, "gmail");
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
  throw new GmailError("Max retries exceeded");
}

export interface EmailContent {
  messageId: string;
  threadId: string | null;
  from: string;
  subject: string;
  body: string;
  receivedAt: Date;
}

export async function fetchNewEmails(
  ceoEmail: string,
  since: Date,
  companyDomains: string[],
): Promise<EmailContent[]> {
  const gmail = getGmailClient(ceoEmail);
  const sinceEpoch = Math.floor(since.getTime() / 1000);
  const domainQuery = companyDomains.map((d) => `from:${d}`).join(" OR ");
  const query = `is:unread (${domainQuery}) after:${sinceEpoch}`;

  const res = await withRetry(() =>
    gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 20,
    }),
  );

  if (!res.data.messages?.length) return [];

  const emails: EmailContent[] = [];
  for (const msg of res.data.messages) {
    if (!msg.id) continue;
    try {
      const content = await getEmailContent(gmail, msg.id);
      if (content) emails.push(content);
    } catch (error) {
      logger.error(`Failed to fetch email ${msg.id}`, "gmail", {
        error: String(error),
      });
    }
  }

  return emails;
}

async function getEmailContent(
  gmail: ReturnType<typeof google.gmail>,
  messageId: string,
): Promise<EmailContent | null> {
  const res = await withRetry(() =>
    gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    }),
  );

  const headers = res.data.payload?.headers ?? [];
  const from = headers.find((h) => h.name === "From")?.value ?? "";
  const subject = headers.find((h) => h.name === "Subject")?.value ?? "";
  const date = headers.find((h) => h.name === "Date")?.value;

  let body = "";
  const payload = res.data.payload;
  if (payload?.body?.data) {
    body = Buffer.from(payload.body.data, "base64").toString("utf-8");
  } else if (payload?.parts) {
    const textPart = payload.parts.find((p) => p.mimeType === "text/plain");
    if (textPart?.body?.data) {
      body = Buffer.from(textPart.body.data, "base64").toString("utf-8");
    }
  }

  return {
    messageId,
    threadId: res.data.threadId ?? null,
    from,
    subject,
    body: body.slice(0, 2000),
    receivedAt: date ? new Date(date) : new Date(),
  };
}

export async function fetchFilteredEmailIds(
  ceoEmail: string,
  since: Date,
  filterQuery: string,
): Promise<string[]> {
  const gmail = getGmailClient(ceoEmail);
  const sinceEpoch = Math.floor(since.getTime() / 1000);
  const query = `${filterQuery} is:unread after:${sinceEpoch}`;

  const res = await withRetry(() =>
    gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 20,
    }),
  );

  if (!res.data.messages?.length) return [];
  return res.data.messages.map((m) => m.id).filter((id): id is string => !!id);
}

export async function getLatestThreadMessageId(
  ceoEmail: string,
  threadId: string,
): Promise<string | null> {
  const gmail = getGmailClient(ceoEmail);

  const res = await withRetry(() =>
    gmail.users.threads.get({
      userId: "me",
      id: threadId,
      format: "metadata",
      metadataHeaders: ["Message-ID"],
    }),
  );

  const messages = res.data.messages;
  if (!messages?.length) return null;

  const lastMessage = messages[messages.length - 1];
  const messageIdHeader = lastMessage.payload?.headers?.find(
    (h) => h.name?.toLowerCase() === "message-id",
  );

  return messageIdHeader?.value ?? null;
}

export async function sendEmail(
  ceoEmail: string,
  to: string,
  subject: string,
  body: string,
  threadId?: string | null,
  inReplyTo?: string | null,
) {
  const gmail = getGmailClient(ceoEmail);

  const replySubject =
    threadId && !subject.toLowerCase().startsWith("re:")
      ? `Re: ${subject}`
      : subject;

  const headers = [
    `To: ${to}`,
    `Subject: ${replySubject}`,
    `Content-Type: text/plain; charset=utf-8`,
  ];

  if (inReplyTo) {
    headers.push(`In-Reply-To: ${inReplyTo}`);
    headers.push(`References: ${inReplyTo}`);
  }

  const message = [...headers, "", body].join("\r\n");

  const encodedMessage = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  await withRetry(() =>
    gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encodedMessage,
        ...(threadId ? { threadId } : {}),
      },
    }),
  );
}

import { google } from "googleapis";
import { GmailError } from "./errors";
import { logger } from "./logger";

function getCeoEmail(): string {
  const email = process.env.CEO_EMAIL;
  if (!email) throw new Error("CEO_EMAIL environment variable is required");
  return email;
}

function getGmailClient(userEmail: string) {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.settings.basic",
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
  to: string;
  cc: string;
  subject: string;
  body: string;
  receivedAt: Date;
}

export async function fetchNewEmails(
  since: Date,
  companyDomains: string[],
): Promise<EmailContent[]> {
  const gmail = getGmailClient(getCeoEmail());
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

export async function fetchEmailById(
  messageId: string,
): Promise<EmailContent | null> {
  const gmail = getGmailClient(getCeoEmail());
  return getEmailContent(gmail, messageId);
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
  const to = headers.find((h) => h.name === "To")?.value ?? "";
  const cc = headers.find((h) => h.name === "Cc")?.value ?? "";
  const subject = headers.find((h) => h.name === "Subject")?.value ?? "";
  const date = headers.find((h) => h.name === "Date")?.value;

  // Recursively find a MIME part by type
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function findPart(parts: any[] | undefined, mimeType: string): any | null {
    if (!parts) return null;
    for (const part of parts) {
      if (part.mimeType === mimeType && part.body?.data) return part;
      const nested = findPart(part.parts, mimeType);
      if (nested) return nested;
    }
    return null;
  }

  function stripHtml(html: string): string {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?(p|div|tr|li|h[1-6])[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#\d+;/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  let body = "";
  const payload = res.data.payload;
  if (payload?.body?.data) {
    body = Buffer.from(payload.body.data, "base64").toString("utf-8");
  } else {
    const textPart = findPart(payload?.parts, "text/plain");
    if (textPart) {
      body = Buffer.from(textPart.body.data, "base64").toString("utf-8");
    } else {
      const htmlPart = findPart(payload?.parts, "text/html");
      if (htmlPart) {
        body = stripHtml(Buffer.from(htmlPart.body.data, "base64").toString("utf-8"));
      }
    }
  }

  return {
    messageId,
    threadId: res.data.threadId ?? null,
    from,
    to,
    cc,
    subject,
    body: body.slice(0, 2000),
    receivedAt: date ? new Date(date) : new Date(),
  };
}

export async function fetchFilteredEmailIds(
  since: Date,
  filterQuery: string,
): Promise<string[]> {
  const gmail = getGmailClient(getCeoEmail());
  const sinceEpoch = Math.floor(since.getTime() / 1000);
  const query = `${filterQuery} after:${sinceEpoch}`;

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

export interface FilterTestResult {
  from: string;
  subject: string;
  date: string;
}

export async function testGmailFilter(
  filterQuery: string,
): Promise<FilterTestResult[]> {
  const gmail = getGmailClient(getCeoEmail());

  const res = await withRetry(() =>
    gmail.users.messages.list({
      userId: "me",
      q: filterQuery,
      maxResults: 3,
    }),
  );

  if (!res.data.messages?.length) return [];

  const results: FilterTestResult[] = [];
  for (const msg of res.data.messages) {
    if (!msg.id) continue;
    const detail = await withRetry(() =>
      gmail.users.messages.get({
        userId: "me",
        id: msg.id!,
        format: "metadata",
        metadataHeaders: ["From", "Subject", "Date"],
      }),
    );
    const headers = detail.data.payload?.headers ?? [];
    results.push({
      from: headers.find((h) => h.name === "From")?.value ?? "",
      subject: headers.find((h) => h.name === "Subject")?.value ?? "",
      date: headers.find((h) => h.name === "Date")?.value ?? "",
    });
  }

  return results;
}

export type ThreadMessageHeaders = Pick<EmailContent, "messageId" | "to" | "cc" | "from"> & {
  replyTo: string | null;
};

export async function getLatestThreadMessage(
  threadId: string,
): Promise<ThreadMessageHeaders | null> {
  const gmail = getGmailClient(getCeoEmail());

  const res = await withRetry(() =>
    gmail.users.threads.get({
      userId: "me",
      id: threadId,
      format: "metadata",
      metadataHeaders: ["Message-ID", "From", "To", "Cc", "Reply-To"],
    }),
  );

  const messages = res.data.messages;
  if (!messages?.length) return null;

  const lastMessage = messages[messages.length - 1];
  const headers = lastMessage.payload?.headers ?? [];
  const getHeader = (name: string) =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";

  const messageId = getHeader("Message-ID");
  if (!messageId) return null;

  return {
    messageId,
    from: getHeader("From"),
    to: getHeader("To"),
    cc: getHeader("Cc"),
    replyTo: getHeader("Reply-To") || null,
  };
}

export async function getSignature(): Promise<string | null> {
  const ceoEmail = getCeoEmail();
  const gmail = getGmailClient(ceoEmail);

  try {
    const res = await withRetry(() =>
      gmail.users.settings.sendAs.get({
        userId: "me",
        sendAsEmail: ceoEmail,
      }),
    );
    return res.data.signature || null;
  } catch (error) {
    logger.warn("Failed to fetch email signature", "gmail", { error: String(error) });
    return null;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

/** Strip CRLF sequences to prevent email header injection */
function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]/g, "");
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  body: string;
  threadId?: string | null;
  inReplyTo?: string | null;
  cc?: string | null;
  bcc?: string | null;
  redirectTo?: string | null;
  signature?: string | null;
}

export async function sendEmail(options: SendEmailOptions) {
  const { to, subject, body, threadId, inReplyTo, cc, bcc, redirectTo } = options;
  const ceoEmail = getCeoEmail();
  const ceoName = process.env.CEO_NAME ?? "Roland Spongberg";
  const gmail = getGmailClient(ceoEmail);

  const signature = options.signature !== undefined ? options.signature : await getSignature();

  const replySubject =
    threadId && !subject.toLowerCase().startsWith("re:")
      ? `Re: ${subject}`
      : subject;

  // Redirect: replace recipients and note originals in body
  let actualTo = to;
  let actualCc = cc;
  let actualBcc = bcc;
  let redirectNote = "";
  if (redirectTo) {
    logger.info(`Redirecting email from [To: ${to}] [CC: ${cc ?? "none"}] [BCC: ${bcc ?? "none"}] → ${redirectTo}`, "gmail");
    actualTo = redirectTo;
    actualCc = null;
    actualBcc = null;
    redirectNote = `<div style="background:#fef3c7;padding:8px 12px;margin-bottom:16px;border-radius:4px;font-size:13px;"><strong>REDIRECTED</strong><br>Original To: ${escapeHtml(to)}<br>Original CC: ${escapeHtml(cc ?? "none")}<br>Original BCC: ${escapeHtml(bcc ?? "none")}</div>`;
  }

  const htmlBody = `${redirectNote}<div>${escapeHtml(body)}</div>${signature ? `<br><div>${signature}</div>` : ""}`;

  const headers = [
    `From: ${sanitizeHeaderValue(ceoName)} <${sanitizeHeaderValue(ceoEmail)}>`,
    `To: ${sanitizeHeaderValue(actualTo)}`,
    ...(actualCc ? [`Cc: ${sanitizeHeaderValue(actualCc)}`] : []),
    ...(actualBcc ? [`Bcc: ${sanitizeHeaderValue(actualBcc)}`] : []),
    `Subject: =?UTF-8?B?${Buffer.from(replySubject).toString("base64")}?=`,
    `Content-Type: text/html; charset=utf-8`,
  ];

  if (inReplyTo) {
    const safeInReplyTo = sanitizeHeaderValue(inReplyTo);
    headers.push(`In-Reply-To: ${safeInReplyTo}`);
    headers.push(`References: ${safeInReplyTo}`);
  }

  const message = [...headers, "", htmlBody].join("\r\n");

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

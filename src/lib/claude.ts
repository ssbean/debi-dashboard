import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { ClaudeError } from "./errors";
import { logger } from "./logger";
import type { Trigger, StyleExample } from "./types";

const anthropic = new Anthropic();

// Classification schema
const ClassificationSchema = z.object({
  matched: z.boolean(),
  trigger_id: z.string().nullable(),
  confidence: z.number().min(0).max(100),
  recipient_email: z.string().email().nullable(),
  recipient_name: z.string().nullable(),
  reasoning: z.string(),
});

// Draft schema
const DraftSchema = z.object({
  subject: z.string().optional(),
  body: z.string(),
});

export type ClassificationOutput = z.infer<typeof ClassificationSchema>;
export type DraftOutput = z.infer<typeof DraftSchema>;
export type TokenUsage = { input_tokens: number; output_tokens: number };

export async function classifyEmail(
  emailFrom: string,
  emailSubject: string,
  emailBody: string,
  triggers: Trigger[],
): Promise<{ result: ClassificationOutput; usage: TokenUsage }> {
  const triggerDescriptions = triggers.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    email_type: t.email_type,
  }));

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system: [
        {
          type: "text",
          text: `You are an email classifier for a CEO's inbox. Analyze incoming emails and determine if they match any of the defined triggers. If matched, extract the recipient information (the person the CEO should send a response TO — this is often mentioned in the email body, not the sender).

Rules:
- Only match if clearly relevant to a trigger
- Confidence 0-100: 90+ = very clear match, 70-89 = likely match, below 70 = uncertain
- Extract recipient email and name if mentioned in the email
- If no match, set matched=false and trigger_id=null`,
          cache_control: { type: "ephemeral" },
        },
        {
          type: "text",
          text: `Available triggers:\n${JSON.stringify(triggerDescriptions, null, 2)}`,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: `From: ${emailFrom}\nSubject: ${emailSubject}\n\n${emailBody}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new ClaudeError("No text response from Claude");
    }

    // Parse JSON from response
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new ClaudeError("No JSON in classification response");
    }

    const parsed = ClassificationSchema.parse(JSON.parse(jsonMatch[0]));

    logger.info("Email classified", "claude", {
      matched: parsed.matched,
      confidence: parsed.confidence,
      cacheRead: response.usage?.cache_read_input_tokens ?? 0,
    });

    return {
      result: parsed,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    };
  } catch (error) {
    if (error instanceof ClaudeError) throw error;
    throw new ClaudeError(`Classification failed: ${error}`);
  }
}

export async function draftEmail(
  trigger: Trigger,
  emailFrom: string,
  emailSubject: string,
  emailBody: string,
  recipientName: string | null,
  recipientEmail: string | null,
  styleExamples: StyleExample[],
): Promise<{ result: DraftOutput; usage: TokenUsage }> {
  const examples = styleExamples
    .map(
      (e) =>
        `--- Example (${e.source}) ---\nSubject: ${e.subject}\n\n${e.body}\n--- End Example ---`,
    )
    .join("\n\n");

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1500,
      system: [
        {
          type: "text",
          text: `You are drafting an email as a CEO. Write in the CEO's voice and style based on the provided examples. The email should be:
- Warm but professional
- Personal and specific to the situation
- Concise (2-4 paragraphs)
- Match the tone and patterns from the style examples

Email type: ${trigger.email_type}
Trigger: ${trigger.name} — ${trigger.description}

Respond with a JSON object: { "body": "..." }
The subject line is handled automatically — only generate the email body.`,
          cache_control: { type: "ephemeral" },
        },
        {
          type: "text",
          text: `Style examples for this trigger:\n\n${examples || "No examples yet. Write a warm, professional email."}`,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: `Trigger email received:
From: ${emailFrom}
Subject: ${emailSubject}
Body: ${emailBody}

Draft a response email from the CEO to: ${recipientName ?? "the recipient"}${recipientEmail ? ` (${recipientEmail})` : ""}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new ClaudeError("No text response from Claude");
    }

    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new ClaudeError("No JSON in draft response");
    }

    return {
      result: DraftSchema.parse(JSON.parse(jsonMatch[0])),
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    };
  } catch (error) {
    if (error instanceof ClaudeError) throw error;
    throw new ClaudeError(`Draft generation failed: ${error}`);
  }
}

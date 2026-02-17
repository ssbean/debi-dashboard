export interface Trigger {
  id: string;
  name: string;
  description: string;
  email_type: "congratulatory" | "promotional" | "welcome";
  reply_in_thread: boolean;
  enabled: boolean;
  match_mode: "llm" | "gmail_filter";
  gmail_filter_query: string | null;
  reply_window_min_hours: number;
  reply_window_max_hours: number;
  sort_order: number;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
}

export interface StyleExample {
  id: string;
  trigger_id: string;
  subject: string;
  body: string;
  source: "seed" | "approved" | "edited";
  created_at: string;
}

export type DraftStatus =
  | "needs_drafting"
  | "pending_review"
  | "approved"
  | "auto_approved"
  | "sent"
  | "failed"
  | "rejected";

export interface Draft {
  id: string;
  trigger_id: string;
  gmail_message_id: string;
  gmail_thread_id: string | null;
  trigger_email_from: string;
  trigger_email_subject: string;
  trigger_email_body_snippet: string | null;
  recipient_email: string | null;
  recipient_name: string | null;
  subject: string | null;
  body: string | null;
  original_body: string | null;
  confidence_score: number;
  status: DraftStatus;
  send_attempts: number;
  scheduled_send_at: string | null;
  sent_at: string | null;
  send_error: string | null;
  approved_by_email: string | null;
  created_at: string;
  updated_at: string | null;
  trigger?: Trigger;
}

export interface Settings {
  id: number;
  confidence_threshold: number;
  ceo_email: string;
  ceo_timezone: string;
  company_domains: string;
  business_hours_start: string;
  business_hours_end: string;
  holidays: string[];
  updated_at: string | null;
}

export interface ClassificationResult {
  trigger_id: string;
  confidence: number;
  recipient_email: string | null;
  recipient_name: string | null;
}

export interface DraftResult {
  subject: string;
  body: string;
}

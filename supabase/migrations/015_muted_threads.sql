-- Track threads that should be auto-archived when new replies arrive.
-- Populated when the system sends a reply-all on behalf of the CEO.
create table if not exists muted_threads (
  id uuid primary key default gen_random_uuid(),
  gmail_thread_id text not null unique,
  draft_id uuid references drafts(id),
  muted_at timestamptz not null default now()
);

create index idx_muted_threads_gmail_thread_id on muted_threads(gmail_thread_id);

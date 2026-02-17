create table cron_logs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  status text not null check (status in ('success', 'error')),
  duration_ms integer not null,
  stats jsonb not null default '{}',
  error_message text,
  started_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index idx_cron_logs_job_started on cron_logs (job_name, started_at desc);

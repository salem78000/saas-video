-- =========================
-- CALLBACK_LOG
-- Section 14 — Webhook logging
-- "Toute réception de callback est loguée : task_id, timestamp,
--  statut reçu, signature valide ou non."
-- =========================

create table public.callback_log (
  id                  uuid primary key default gen_random_uuid(),
  provider            text not null default 'kieai',
  task_id_provider    text not null,
  render_job_id       uuid references public.render_job(id) on delete set null,
  status_received     text,
  signature_valid     boolean not null,
  body_hash           text,                               -- SHA-256 of raw body for audit
  processed           boolean not null default false,      -- true once the job was updated
  duplicate           boolean not null default false,      -- true if this was a dedup hit
  error_detail        text,                               -- any processing error
  received_at         timestamptz not null default now()
);

comment on table public.callback_log is 'Log de chaque callback reçu. Déduplication et audit trail (spec §14).';

create index idx_callback_log_task_id on public.callback_log(task_id_provider);
create index idx_callback_log_received on public.callback_log(received_at);

alter table public.callback_log enable row level security;

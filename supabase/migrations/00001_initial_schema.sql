-- ============================================================
-- SaaS Vidéo Multi-Shot — Schéma initial
-- Basé sur la spec v3 (saas_multishot_spec_v3.html)
--
-- Tables :
--   1. workspace          (section 11 — objet 1)
--   2. api_connection      (section 3 — sécurité des clés BYOK)
--   3. brand_pack          (section 11/12 — objet 2)
--   4. project             (section 11 — objet 3, inclut pack de continuité)
--   5. shot_plan           (section 11 — objet 4, séquence ordonnée)
--   6. render_job          (section 11/14 — objet 5, cycle de vie complet)
--   7. render_version      (section 15 — versioning des rendus)
-- ============================================================

create extension if not exists "pgcrypto";

-- =========================
-- 1. WORKSPACE
-- Section 11 — Objet 1
-- "Espace de travail d'un utilisateur ou d'une équipe.
--  Contient tous les projets, Brand Packs et connexions API.
--  Anticipé dans le schéma pour permettre la collaboration future sans refonte."
-- =========================
create table public.workspace (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,
  owner_id      uuid not null,                          -- references auth.users(id)
  plan          text not null default 'free'
                  check (plan in ('free', 'pro', 'business', 'enterprise')),
  settings      jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.workspace is 'Espace de travail multi-tenant. Anticipe le modèle équipes sans l''implémenter (spec §11).';

create index idx_workspace_owner on public.workspace(owner_id);
create unique index idx_workspace_slug on public.workspace(slug);

-- =========================
-- 2. API_CONNECTION
-- Section 3 — Sécurité des clés BYOK
-- "Chiffrement AES-256 côté serveur avant stockage.
--  Seuls les 4 derniers caractères affichés pour identification.
--  La clé en clair n'existe qu'en mémoire le temps de l'appel API."
-- Statuts : connected / disconnected / key_invalid
-- =========================
create table public.api_connection (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspace(id) on delete cascade,
  provider          text not null
                      check (provider in ('kieai', 'veo', 'runway', 'luma')),
  status            text not null default 'disconnected'
                      check (status in ('connected', 'disconnected', 'key_invalid')),
  encrypted_key     bytea,                              -- clé chiffrée AES-256 via pgcrypto
  key_last_four     text,                               -- 4 derniers caractères pour affichage (••••xxxx)
  balance_cached    numeric,                            -- dernier solde connu (via GET /api/v1/user/info)
  balance_checked_at timestamptz,                       -- date du dernier check solde
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.api_connection is 'Stockage chiffré des clés API BYOK par provider (spec §3). La clé en clair ne doit JAMAIS apparaître dans les logs.';

create index idx_api_connection_workspace on public.api_connection(workspace_id);
-- Un seul enregistrement par provider par workspace
alter table public.api_connection
  add constraint uq_api_connection_provider unique (workspace_id, provider);

-- =========================
-- 3. BRAND_PACK
-- Section 11 — Objet 2 / Section 12
-- "Références visuelles et style réutilisables entre plusieurs projets.
--  Contenu : nom, images de référence globales (jusqu'à 10), style global,
--  palette de couleurs, contraintes caméra, règles de cohérence, notes internes."
-- =========================
create table public.brand_pack (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspace(id) on delete cascade,
  name                text not null,
  reference_images    jsonb not null default '[]',       -- URLs des images de référence (max 10)
  global_style        text,                              -- description texte du style global
  color_palette       jsonb not null default '[]',       -- ex: ["#FF5733","#1A1A2E"]
  camera_constraints  text,                              -- contraintes caméra (texte)
  coherence_rules     text,                              -- règles de cohérence visuelle
  notes               text,                              -- notes internes
  is_default          boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.brand_pack is 'Kit de marque réutilisable entre projets : images de référence, style, palette, contraintes (spec §12).';

create index idx_brand_pack_workspace on public.brand_pack(workspace_id);

-- =========================
-- 4. PROJECT
-- Section 11 — Objet 3 / Section 9 (wizard) / Section 10 (autosave)
-- "Conteneur d'une vidéo. Hérite optionnellement d'un Brand Pack.
--  Contient un Pack de continuité propre, un Plan de shots, et des Jobs de rendu."
--
-- Le Pack de continuité (section 9, étape 2) est stocké inline dans le projet :
--   - Image d'entrée principale (obligatoire en multi-shot Kie.ai)
--   - Éléments de référence nommés (max 3 éléments, 2-4 images chacun)
--   - Style global, contraintes caméra
--   - Score de complétude : faible / correct / fort
--
-- Wizard tracking (section 10) :
--   - wizard_step : dernière étape complétée (1-6)
--   - wizard_completed : toutes les étapes validées
-- =========================
create table public.project (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspace(id) on delete cascade,
  brand_pack_id         uuid references public.brand_pack(id) on delete set null,
  name                  text not null,
  description           text,
  status                text not null default 'draft'
                          check (status in ('draft', 'ready_for_render', 'rendering', 'completed', 'failed')),

  -- Format & durée (wizard étape 1)
  aspect_ratio          text not null default '16:9'
                          check (aspect_ratio in ('16:9', '9:16', '1:1')),
  duration_total_s      numeric,                         -- durée totale = somme des shots
  mode                  text not null default 'std'
                          check (mode in ('std', 'pro')),   -- Standard vs High Speed (Kie.ai)
  sound_enabled         boolean not null default false,     -- génération sonore

  -- Pack de continuité (wizard étape 2)
  -- Image d'entrée principale (obligatoire pour multi-shot Kie.ai)
  entry_image_url       text,
  -- Éléments de référence nommés : [{name:"ref_01", images:["url1","url2"]}]
  -- Max 3 éléments, 2-4 images chacun (contrainte Kling)
  reference_elements    jsonb not null default '[]',
  global_style          text,                             -- style global hérité ou custom
  camera_constraints    text,                             -- contraintes caméra
  continuity_score      text not null default 'low'
                          check (continuity_score in ('low', 'medium', 'high')),

  -- Wizard tracking & autosave (section 10)
  wizard_step           int not null default 1
                          check (wizard_step >= 1 and wizard_step <= 6),
  wizard_completed      boolean not null default false,

  -- Provider sélectionné (wizard étape 4)
  provider              text check (provider in ('kieai', 'veo', 'runway', 'luma')),

  -- Budget garde-fous (section 4)
  budget_max            numeric,                          -- plafond budget optionnel
  budget_spent          numeric not null default 0,       -- cumul des coûts estimés

  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.project is 'Projet vidéo multi-shot avec pack de continuité inline et suivi wizard (spec §9, §10, §11).';

create index idx_project_workspace on public.project(workspace_id);
create index idx_project_status on public.project(status);

-- =========================
-- 5. SHOT_PLAN
-- Section 11 — Objet 4 / Section 5 (Kie.ai)
-- "Séquence ordonnée des shots. Chaque shot a sa durée, son prompt,
--  ses références d'éléments. L'ordre détermine le tableau multi_prompt[]
--  envoyé à Kie.ai."
--
-- Contraintes Kling 3.0 (section 5) :
--   - Durée par shot : min 1s, max 12s
--   - Prompt par shot : max 500 caractères
--   - Somme des durées = durée totale déclarée
-- =========================
create table public.shot_plan (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.project(id) on delete cascade,
  order_index         int not null,                       -- position dans la séquence (drag-and-drop)
  prompt              text not null,                      -- prompt de génération (max 500 chars pour Kling)
  duration_s          numeric not null default 5
                        check (duration_s >= 1 and duration_s <= 12),  -- contrainte Kling
  -- Références d'éléments injectés dans ce shot : ["ref_01", "ref_02"]
  element_refs        jsonb not null default '[]',
  -- Validation en temps réel (section 9, étape 3)
  is_valid            boolean not null default false,     -- indicateur vert/rouge par shot
  validation_errors   jsonb not null default '[]',        -- liste des erreurs de validation
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.shot_plan is 'Shot individuel dans la séquence. L''ordre détermine multi_prompt[] envoyé à Kie.ai (spec §5, §11).';

create index idx_shot_plan_project on public.shot_plan(project_id);
create index idx_shot_plan_order on public.shot_plan(project_id, order_index);

alter table public.shot_plan
  add constraint uq_shot_plan_order unique (project_id, order_index);

-- =========================
-- 6. RENDER_JOB
-- Section 11 — Objet 5 / Section 14 (orchestration)
-- "Exécution technique. Lié à un provider, une clé API utilisateur,
--  un payload envoyé, et un résultat versionné. Cycle de vie complet
--  avec statuts enrichis."
--
-- Statuts (section 14) :
--   draft → ready_for_render → queued → submitted → processing
--   → retrying → succeeded / failed / cancelled → archived
-- =========================
create table public.render_job (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.project(id) on delete cascade,
  provider            text not null default 'kieai'
                        check (provider in ('kieai', 'veo', 'runway', 'luma')),
  status              text not null default 'queued'
                        check (status in (
                          'queued', 'submitted', 'processing', 'retrying',
                          'succeeded', 'failed', 'cancelled', 'archived'
                        )),

  -- Idempotence (section 14)
  idempotency_key     uuid not null default gen_random_uuid(),
  -- Task ID du provider (visible pour l'utilisateur — section 15)
  provider_task_id    text,                               -- ex: task_id Kie.ai

  -- Coût (section 4)
  estimated_cost      numeric,                            -- coût estimé affiché avant soumission
  actual_cost         numeric,                            -- coût réel si disponible

  -- Retry (section 14)
  retry_count         int not null default 0,
  max_retries         int not null default 3,

  -- Erreur
  error_code          text,                               -- snake_case: invalid_api_key, insufficient_balance, etc.
  error_message       text,                               -- message humain

  -- Callback / webhook (section 14)
  callback_url        text,

  -- Timestamps
  submitted_at        timestamptz,
  processing_at       timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.render_job is 'Job de rendu avec cycle de vie complet et idempotence (spec §14). Le task_id provider est toujours visible pour l''utilisateur.';

create index idx_render_job_project on public.render_job(project_id);
create index idx_render_job_status on public.render_job(status);
create unique index idx_render_job_idempotency on public.render_job(idempotency_key);

-- =========================
-- 7. RENDER_VERSION
-- Section 15 — Versioning
-- "Chaque soumission à Kie.ai crée une version indépendante.
--  L'utilisateur peut rejouer, comparer ou dupliquer n'importe quelle version."
-- =========================
create table public.render_version (
  id                        uuid primary key default gen_random_uuid(),
  render_job_id             uuid not null references public.render_job(id) on delete cascade,
  project_id                uuid not null references public.project(id) on delete cascade,

  -- Snapshots figés au moment de la soumission
  config_snapshot           jsonb not null,                -- copie de la config globale du projet
  shots_snapshot            jsonb not null,                -- copie de la séquence de shots envoyée
  provider_used             text not null,                 -- provider + version du modèle (ex: "kieai/kling-v3")

  -- Payload envoyé — REDACTED (section 15)
  -- "JSON envoyé à Kie.ai, nettoyé : clé API retirée, URLs signées remplacées
  --  par des identifiants d'asset internes, champs sensibles masqués"
  payload_sent_redacted     jsonb,

  -- Résultat
  task_id_provider          text,                          -- task_id Kie.ai — visible pour réconciliation
  result_urls               jsonb not null default '[]',   -- URLs de la vidéo générée
  estimated_cost            numeric,                       -- coût estimé affiché avant soumission

  -- Erreur (redacted — accessible en mode debug uniquement)
  error_log_redacted        jsonb,

  -- Idempotence
  idempotency_key           uuid not null,

  created_at                timestamptz not null default now()
);

comment on table public.render_version is 'Version archivée de chaque rendu. Snapshots figés, payload redacted, résultats (spec §15).';

create index idx_render_version_job on public.render_version(render_job_id);
create index idx_render_version_project on public.render_version(project_id);

-- =========================
-- Trigger updated_at automatique
-- =========================
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_workspace_updated_at
  before update on public.workspace
  for each row execute function public.handle_updated_at();

create trigger set_api_connection_updated_at
  before update on public.api_connection
  for each row execute function public.handle_updated_at();

create trigger set_brand_pack_updated_at
  before update on public.brand_pack
  for each row execute function public.handle_updated_at();

create trigger set_project_updated_at
  before update on public.project
  for each row execute function public.handle_updated_at();

create trigger set_shot_plan_updated_at
  before update on public.shot_plan
  for each row execute function public.handle_updated_at();

create trigger set_render_job_updated_at
  before update on public.render_job
  for each row execute function public.handle_updated_at();

-- =========================
-- Row Level Security (RLS)
-- =========================
alter table public.workspace enable row level security;
alter table public.api_connection enable row level security;
alter table public.brand_pack enable row level security;
alter table public.project enable row level security;
alter table public.shot_plan enable row level security;
alter table public.render_job enable row level security;
alter table public.render_version enable row level security;

-- Workspace : seul le owner
create policy "workspace_owner_all" on public.workspace
  for all using (auth.uid() = owner_id);

-- API Connection : via workspace ownership
create policy "api_connection_workspace_access" on public.api_connection
  for all using (
    exists (
      select 1 from public.workspace w
      where w.id = api_connection.workspace_id
        and w.owner_id = auth.uid()
    )
  );

-- Brand Pack : via workspace ownership
create policy "brand_pack_workspace_access" on public.brand_pack
  for all using (
    exists (
      select 1 from public.workspace w
      where w.id = brand_pack.workspace_id
        and w.owner_id = auth.uid()
    )
  );

-- Project : via workspace ownership
create policy "project_workspace_access" on public.project
  for all using (
    exists (
      select 1 from public.workspace w
      where w.id = project.workspace_id
        and w.owner_id = auth.uid()
    )
  );

-- Shot Plan : via project → workspace
create policy "shot_plan_project_access" on public.shot_plan
  for all using (
    exists (
      select 1 from public.project p
      join public.workspace w on w.id = p.workspace_id
      where p.id = shot_plan.project_id
        and w.owner_id = auth.uid()
    )
  );

-- Render Job : via project → workspace
create policy "render_job_project_access" on public.render_job
  for all using (
    exists (
      select 1 from public.project p
      join public.workspace w on w.id = p.workspace_id
      where p.id = render_job.project_id
        and w.owner_id = auth.uid()
    )
  );

-- Render Version : via project → workspace
create policy "render_version_project_access" on public.render_version
  for all using (
    exists (
      select 1 from public.project p
      join public.workspace w on w.id = p.workspace_id
      where p.id = render_version.project_id
        and w.owner_id = auth.uid()
    )
  );

// =============================================================
// Types partagés — basés sur la spec v3
// =============================================================

// --- Enums ---

export type Plan = "free" | "pro" | "business" | "enterprise";

export type Provider = "kieai" | "veo" | "runway" | "luma";

export type ApiConnectionStatus = "connected" | "disconnected" | "key_invalid";

export type ProjectStatus = "draft" | "ready_for_render" | "rendering" | "completed" | "failed";

export type AspectRatio = "16:9" | "9:16" | "1:1";

export type RenderMode = "std" | "pro";

export type ContinuityScore = "low" | "medium" | "high";

// Section 14 — Statuts enrichis du cycle de vie
export type RenderJobStatus =
  | "queued"
  | "submitted"
  | "processing"
  | "retrying"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "archived";

// Section 5 — Erreurs nommées Kie.ai
export type ErrorCode =
  | "invalid_api_key"
  | "insufficient_balance"
  | "payload_validation_error"
  | "rate_limit_exceeded"
  | "provider_error"
  | "key_expired"
  | "invalid_key_format"
  | "shot_duration_exceeded";

// --- Interfaces ---

/** Section 11 — Objet 1 : Workspace */
export interface Workspace {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  plan: Plan;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Section 3 — Connexion API BYOK */
export interface ApiConnection {
  id: string;
  workspace_id: string;
  provider: Provider;
  status: ApiConnectionStatus;
  key_last_four: string | null;       // "••••••••xxxx"
  balance_cached: number | null;
  balance_checked_at: string | null;
  created_at: string;
  updated_at: string;
  // encrypted_key n'est JAMAIS exposé côté frontend
}

/** Section 11/12 — Objet 2 : Brand Pack */
export interface BrandPack {
  id: string;
  workspace_id: string;
  name: string;
  reference_images: string[];          // URLs (max 10)
  global_style: string | null;
  color_palette: string[];
  camera_constraints: string | null;
  coherence_rules: string | null;
  notes: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

/** Élément de référence nommé dans le Pack de continuité */
export interface ReferenceElement {
  name: string;                        // ex: "ref_01", "ref_02"
  images: string[];                    // 2-4 images par élément, max 3 éléments
}

/** Section 11 — Objet 3 : Projet */
export interface Project {
  id: string;
  workspace_id: string;
  brand_pack_id: string | null;
  name: string;
  description: string | null;
  status: ProjectStatus;

  // Format (wizard étape 1)
  aspect_ratio: AspectRatio;
  duration_total_s: number | null;
  mode: RenderMode;
  sound_enabled: boolean;

  // Pack de continuité (wizard étape 2)
  entry_image_url: string | null;       // image d'entrée obligatoire (Kie.ai multi-shot)
  reference_elements: ReferenceElement[];
  global_style: string | null;
  camera_constraints: string | null;
  continuity_score: ContinuityScore;

  // Wizard (section 10)
  wizard_step: number;                  // 1-6
  wizard_completed: boolean;

  // Provider (wizard étape 4)
  provider: Provider | null;

  // Budget (section 4)
  budget_max: number | null;
  budget_spent: number;

  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Section 11 — Objet 4 : Shot Plan */
export interface ShotPlan {
  id: string;
  project_id: string;
  order_index: number;
  prompt: string;                       // max 500 chars (Kling)
  duration_s: number;                   // 1-12s (Kling)
  element_refs: string[];               // références aux éléments du pack de continuité
  is_valid: boolean;
  validation_errors: string[];
  created_at: string;
  updated_at: string;
}

/** Section 11/14 — Objet 5 : Render Job */
export interface RenderJob {
  id: string;
  project_id: string;
  provider: Provider;
  status: RenderJobStatus;
  idempotency_key: string;
  provider_task_id: string | null;      // task_id Kie.ai — visible pour l'utilisateur
  estimated_cost: number | null;
  actual_cost: number | null;
  retry_count: number;
  max_retries: number;
  error_code: ErrorCode | null;
  error_message: string | null;
  callback_url: string | null;
  submitted_at: string | null;
  processing_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Section 15 — Version de rendu */
export interface RenderVersion {
  id: string;
  render_job_id: string;
  project_id: string;
  config_snapshot: Record<string, unknown>;
  shots_snapshot: ShotPlan[];
  provider_used: string;                // ex: "kieai/kling-v3"
  payload_sent_redacted: Record<string, unknown> | null;
  task_id_provider: string | null;
  result_urls: string[];
  estimated_cost: number | null;
  error_log_redacted: Record<string, unknown> | null;
  idempotency_key: string;
  created_at: string;
}

// --- Kie.ai Payload (section 5) ---

export interface KieaiMultiPromptShot {
  prompt: string;
  duration: number;
}

export interface KieaiElement {
  name: string;
  image_urls: string[];
}

/** Structure du payload envoyé à Kie.ai (section 5) */
export interface KieaiPayload {
  model: "kling-v3";
  callBackUrl?: string;
  input: {
    multi_shots: true;
    image_urls: string[];               // 1 seule image en multi-shot
    duration: number;                   // somme des shots
    aspect_ratio: "16:9" | "9:16" | "1:1";
    mode: "std" | "pro";
    sound: boolean;
    multi_prompt: KieaiMultiPromptShot[];
    kling_elements?: KieaiElement[];    // max 3 éléments, 2-4 images chacun
  };
}

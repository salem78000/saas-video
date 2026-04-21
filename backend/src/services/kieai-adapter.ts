// Types re-exported from shared/types to avoid rootDir issues.
// These mirror the canonical definitions in shared/types/index.ts.

type AspectRatio = "16:9" | "9:16" | "1:1";
type RenderMode = "std" | "pro";

type ErrorCode =
  | "invalid_api_key"
  | "insufficient_balance"
  | "payload_validation_error"
  | "rate_limit_exceeded"
  | "provider_error"
  | "key_expired"
  | "invalid_key_format"
  | "shot_duration_exceeded";

interface ReferenceElement {
  name: string;
  images: string[];
}

interface ProjectLike {
  aspect_ratio: AspectRatio;
  mode: RenderMode;
  sound_enabled: boolean;
  entry_image_url: string | null;
  reference_elements: ReferenceElement[];
}

interface ShotPlanLike {
  order_index: number;
  prompt: string;
  duration_s: number;
}

interface KieaiMultiPromptShot {
  prompt: string;
  duration: number;
}

interface KieaiElement {
  name: string;
  image_urls: string[];
}

interface KieaiPayload {
  model: "kling-v3";
  callBackUrl?: string;
  input: {
    multi_shots: true;
    image_urls: string[];
    duration: number;
    aspect_ratio: AspectRatio;
    mode: RenderMode;
    sound: boolean;
    multi_prompt: KieaiMultiPromptShot[];
    kling_elements?: KieaiElement[];
  };
}

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface ProviderConstraints {
  shotDurationMin: number;
  shotDurationMax: number;
  promptMaxLength: number;
  maxElements: number;
  maxImagesPerElement: number;
  entryImageRequired: boolean;
  supportedAspectRatios: string[];
  supportedModes: string[];
}

export interface CallbackResult {
  taskId: string;
  status: "succeeded" | "failed" | "processing";
  resultUrls: string[];
  errorCode: ErrorCode | null;
  errorMessage: string | null;
  cost: number | null;
}

export interface BalanceResult {
  balance: number;
  sufficient: boolean;
}

// ---------------------------------------------------------------------------
// getConstraints — Kling v3 limits from spec §5
// ---------------------------------------------------------------------------

export function getConstraints(): ProviderConstraints {
  return {
    shotDurationMin: 1,
    shotDurationMax: 12,
    promptMaxLength: 500,
    maxElements: 3,
    maxImagesPerElement: 4,
    entryImageRequired: true,
    supportedAspectRatios: ["16:9", "9:16", "1:1"],
    supportedModes: ["std", "pro"],
  };
}

// ---------------------------------------------------------------------------
// getErrorMessage — Spec §5 exact user-facing messages
// ---------------------------------------------------------------------------

const ERROR_MESSAGES: Record<string, string> = {
  invalid_api_key:
    "Ta clé Kie.ai est invalide ou expirée. Mets-la à jour dans Mes connexions.",
  insufficient_balance:
    "Ton solde Kie.ai est insuffisant pour ce rendu. Recharge ton compte et relance.",
  payload_validation_error:
    "Un paramètre du projet est invalide.",
  rate_limit_exceeded:
    "Kie.ai a temporairement limité tes requêtes. Le rendu sera relancé automatiquement.",
  provider_error:
    "Kie.ai a rencontré une erreur technique. Le rendu sera retentée automatiquement.",
};

export function getErrorMessage(code: string, detail?: string): string {
  const base = ERROR_MESSAGES[code] ?? `Erreur inattendue (${code}).`;
  if (code === "payload_validation_error" && detail) {
    return `${base} Détails : ${detail}`;
  }
  return base;
}

// ---------------------------------------------------------------------------
// buildPayload — Spec §5: translate Project + ShotPlans → KieaiPayload
// ---------------------------------------------------------------------------

export function buildPayload(
  project: ProjectLike,
  shots: ShotPlanLike[],
  callbackUrl?: string
): KieaiPayload {
  // Validate entry image
  if (!project.entry_image_url) {
    throw new Error("entry_image_url is required for Kie.ai multi-shot");
  }

  // Sort shots by order_index
  const sorted = [...shots].sort((a, b) => a.order_index - b.order_index);

  // Build multi_prompt array
  const multiPrompt = sorted.map((shot) => ({
    prompt: shot.prompt,
    duration: shot.duration_s,
  }));

  // Total duration = sum of all shots
  const totalDuration = sorted.reduce((sum, s) => sum + s.duration_s, 0);

  // Build kling_elements from project reference_elements
  let klingElements: KieaiElement[] | undefined;
  if (project.reference_elements.length > 0) {
    klingElements = project.reference_elements
      .slice(0, getConstraints().maxElements)
      .map((el) => ({
        name: el.name,
        image_urls: el.images.slice(0, getConstraints().maxImagesPerElement),
      }));
  }

  const payload: KieaiPayload = {
    model: "kling-v3",
    ...(callbackUrl ? { callBackUrl: callbackUrl } : {}),
    input: {
      multi_shots: true,
      image_urls: [project.entry_image_url],
      duration: totalDuration,
      aspect_ratio: project.aspect_ratio,
      mode: project.mode,
      sound: project.sound_enabled,
      multi_prompt: multiPrompt,
      ...(klingElements ? { kling_elements: klingElements } : {}),
    },
  };

  return payload;
}

// ---------------------------------------------------------------------------
// parseCallback — Spec §13: parse Kie.ai webhook body
// ---------------------------------------------------------------------------

interface KieaiCallbackBody {
  task_id?: string;
  status?: string;
  output?: { video_url?: string; video_urls?: string[] };
  error?: { code?: string; message?: string };
  cost?: number;
}

export function parseCallback(body: unknown): CallbackResult {
  const cb = body as KieaiCallbackBody;

  const taskId = cb.task_id ?? "";

  // Determine result URLs
  const resultUrls: string[] = [];
  if (cb.output?.video_urls && Array.isArray(cb.output.video_urls)) {
    resultUrls.push(...cb.output.video_urls);
  } else if (cb.output?.video_url) {
    resultUrls.push(cb.output.video_url);
  }

  // Map provider status to internal status
  let status: CallbackResult["status"];
  if (cb.status === "succeeded" || cb.status === "completed") {
    status = "succeeded";
  } else if (cb.status === "failed" || cb.status === "error") {
    status = "failed";
  } else {
    status = "processing";
  }

  // Map error if present
  let errorCode: ErrorCode | null = null;
  let errorMessage: string | null = null;
  if (status === "failed" && cb.error) {
    errorCode = mapProviderErrorCode(cb.error.code);
    errorMessage = cb.error.message ?? getErrorMessage(errorCode ?? "provider_error");
  }

  return {
    taskId,
    status,
    resultUrls,
    errorCode,
    errorMessage,
    cost: typeof cb.cost === "number" ? cb.cost : null,
  };
}

function mapProviderErrorCode(code: string | undefined): ErrorCode {
  switch (code) {
    case "invalid_api_key":
    case "unauthorized":
      return "invalid_api_key";
    case "insufficient_balance":
    case "payment_required":
      return "insufficient_balance";
    case "validation_error":
    case "invalid_params":
      return "payload_validation_error";
    case "rate_limit":
    case "too_many_requests":
      return "rate_limit_exceeded";
    default:
      return "provider_error";
  }
}

// ---------------------------------------------------------------------------
// checkBalance — Spec §5: GET /api/v1/chat/credit
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 10_000;

function getBaseUrl(): string {
  return process.env.KIEAI_API_BASE_URL || "https://api.kie.ai";
}

export async function checkBalance(apiKey: string): Promise<BalanceResult> {
  const url = `${getBaseUrl()}/api/v1/chat/credit`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AdapterError("network_error", "Failed to reach Kie.ai API");
  }

  if (!response.ok) {
    throw mapHttpError(response.status);
  }

  // Response format: { code: 200, msg: "success", data: 6991 }
  const body = (await response.json()) as Record<string, unknown>;
  const balance = typeof body.data === "number" ? body.data : 0;

  return { balance, sufficient: balance > 0 };
}

// ---------------------------------------------------------------------------
// Error mapping — HTTP status → AdapterError with spec §5 codes
// ---------------------------------------------------------------------------

export class AdapterError extends Error {
  constructor(
    public readonly code: ErrorCode | "network_error",
    message: string,
    public readonly detail?: string
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

function mapHttpError(status: number): AdapterError {
  switch (status) {
    case 401:
      return new AdapterError(
        "invalid_api_key",
        getErrorMessage("invalid_api_key")
      );
    case 402:
      return new AdapterError(
        "insufficient_balance",
        getErrorMessage("insufficient_balance")
      );
    case 422:
      return new AdapterError(
        "payload_validation_error",
        getErrorMessage("payload_validation_error")
      );
    case 429:
      return new AdapterError(
        "rate_limit_exceeded",
        getErrorMessage("rate_limit_exceeded")
      );
    default:
      return new AdapterError(
        "provider_error",
        getErrorMessage("provider_error")
      );
  }
}

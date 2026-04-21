import { Router, raw } from "express";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { supabase } from "../config/supabase.js";
import { parseCallback } from "../services/kieai-adapter.js";

export const webhookRoutes = Router();

// Parse raw body for HMAC verification — must come before express.json()
webhookRoutes.use(raw({ type: "application/json" }));

// ---------------------------------------------------------------------------
// HMAC-SHA256 signature verification
// ---------------------------------------------------------------------------

function verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
  const secret = process.env.KIEAI_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[webhook] KIEAI_WEBHOOK_SECRET is not configured");
    return false;
  }

  if (!signature) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

  // Constant-time comparison to prevent timing attacks
  try {
    return timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected, "hex")
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashBody(rawBody: Buffer): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

async function logCallback(entry: {
  task_id_provider: string;
  render_job_id: string | null;
  status_received: string | null;
  signature_valid: boolean;
  body_hash: string;
  processed: boolean;
  duplicate: boolean;
  error_detail: string | null;
}) {
  await supabase.from("callback_log").insert({
    provider: "kieai",
    ...entry,
  });
}

/**
 * Find the render_job matching a provider task_id.
 * Used both for normal callback handling and reconciliation.
 */
async function findJobByTaskId(taskId: string) {
  const { data, error } = await supabase
    .from("render_job")
    .select("id, project_id, status, provider_task_id, retry_count, max_retries")
    .eq("provider_task_id", taskId)
    .single();

  if (error || !data) return null;
  return data;
}

/**
 * Check if this task_id already has a terminal callback logged
 * (processed=true with a succeeded or failed status).
 * This is the deduplication gate.
 */
async function isAlreadyProcessed(taskId: string): Promise<boolean> {
  const { count } = await supabase
    .from("callback_log")
    .select("*", { count: "exact", head: true })
    .eq("task_id_provider", taskId)
    .eq("processed", true)
    .in("status_received", ["succeeded", "completed", "failed", "error"]);

  return (count ?? 0) > 0;
}

// Terminal statuses — a job in one of these should not be updated by a callback
const TERMINAL_STATUSES = ["succeeded", "failed", "cancelled", "archived"];

// ---------------------------------------------------------------------------
// POST /webhooks/kieai — Receive Kie.ai callback
// ---------------------------------------------------------------------------

webhookRoutes.post("/kieai", async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
  const bodyHash = hashBody(rawBody);

  // 1. Verify HMAC signature
  const signature = req.headers["x-kieai-signature"] as string | undefined;
  const signatureValid = verifySignature(rawBody, signature);

  // Parse body regardless — we need task_id for logging
  let parsed: ReturnType<typeof parseCallback>;
  try {
    const json = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString("utf8")) : req.body;
    parsed = parseCallback(json);
  } catch {
    await logCallback({
      task_id_provider: "unknown",
      render_job_id: null,
      status_received: null,
      signature_valid: signatureValid,
      body_hash: bodyHash,
      processed: false,
      duplicate: false,
      error_detail: "Failed to parse callback body",
    });
    // Return 200 to prevent Kie.ai from retrying unparseable payloads
    res.status(200).json({ received: true });
    return;
  }

  const { taskId, status, resultUrls, errorCode, errorMessage, cost } = parsed;

  // Reject invalid signature after parsing (so we can log the task_id)
  if (!signatureValid) {
    await logCallback({
      task_id_provider: taskId,
      render_job_id: null,
      status_received: status,
      signature_valid: false,
      body_hash: bodyHash,
      processed: false,
      duplicate: false,
      error_detail: "Invalid HMAC signature",
    });
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  // 2. Find the matching render job
  const job = await findJobByTaskId(taskId);
  if (!job) {
    await logCallback({
      task_id_provider: taskId,
      render_job_id: null,
      status_received: status,
      signature_valid: true,
      body_hash: bodyHash,
      processed: false,
      duplicate: false,
      error_detail: "No matching render_job found",
    });
    // 200 so Kie.ai doesn't retry — we'll reconcile later if needed
    res.status(200).json({ received: true });
    return;
  }

  // 3. Deduplication: skip if a terminal callback was already processed
  if (await isAlreadyProcessed(taskId)) {
    await logCallback({
      task_id_provider: taskId,
      render_job_id: job.id,
      status_received: status,
      signature_valid: true,
      body_hash: bodyHash,
      processed: false,
      duplicate: true,
      error_detail: null,
    });
    res.status(200).json({ received: true, duplicate: true });
    return;
  }

  // 4. Skip if job is already in a terminal status (idempotent)
  if (TERMINAL_STATUSES.includes(job.status)) {
    await logCallback({
      task_id_provider: taskId,
      render_job_id: job.id,
      status_received: status,
      signature_valid: true,
      body_hash: bodyHash,
      processed: false,
      duplicate: true,
      error_detail: `Job already in terminal status: ${job.status}`,
    });
    res.status(200).json({ received: true, duplicate: true });
    return;
  }

  // 5. Apply state transition
  let processingError: string | null = null;

  try {
    if (status === "succeeded") {
      await supabase
        .from("render_job")
        .update({
          status: "succeeded",
          actual_cost: cost,
          error_code: null,
          error_message: null,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      // Update project status
      await supabase
        .from("project")
        .update({ status: "completed" })
        .eq("id", job.project_id);

      // Store result URLs in render_version
      if (resultUrls.length > 0) {
        await supabase
          .from("render_version")
          .update({
            result_urls: resultUrls,
            task_id_provider: taskId,
          })
          .eq("render_job_id", job.id);
      }
    } else if (status === "failed") {
      await supabase
        .from("render_job")
        .update({
          status: "failed",
          error_code: errorCode,
          error_message: errorMessage,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      await supabase
        .from("project")
        .update({ status: "failed" })
        .eq("id", job.project_id);
    } else {
      // processing — update status only if still earlier in lifecycle
      await supabase
        .from("render_job")
        .update({
          status: "processing",
          processing_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .in("status", ["queued", "submitted"]);
    }
  } catch (err) {
    processingError =
      err instanceof Error ? err.message : "Unknown processing error";
  }

  // 6. Log the callback
  await logCallback({
    task_id_provider: taskId,
    render_job_id: job.id,
    status_received: status,
    signature_valid: true,
    body_hash: bodyHash,
    processed: processingError === null,
    duplicate: false,
    error_detail: processingError,
  });

  res.status(200).json({ received: true });
});

// ---------------------------------------------------------------------------
// POST /webhooks/kieai/reconcile — Reconcile missed callbacks
// Poll Kie.ai for all in-flight jobs and update their status.
// Called at startup or manually when the SaaS was down.
// ---------------------------------------------------------------------------

webhookRoutes.post("/kieai/reconcile", async (req, res) => {
  // Require internal auth (service key or admin)
  const authHeader = req.headers.authorization;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!authHeader || authHeader !== `Bearer ${serviceKey}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const INFLIGHT_STATUSES = ["submitted", "processing", "retrying"];

  // Find all jobs that are in-flight
  const { data: jobs, error } = await supabase
    .from("render_job")
    .select("id, project_id, provider_task_id, status, retry_count, max_retries")
    .in("status", INFLIGHT_STATUSES)
    .not("provider_task_id", "is", null);

  if (error || !jobs) {
    res.status(500).json({ error: "Failed to query in-flight jobs" });
    return;
  }

  const baseUrl = process.env.KIEAI_API_BASE_URL || "https://api.kieai.com";
  const results: Array<{ jobId: string; taskId: string; newStatus: string }> = [];

  for (const job of jobs) {
    if (!job.provider_task_id) continue;

    // We need the decrypted API key for this job's workspace.
    // Fetch the api_connection for the project's workspace.
    const { data: project } = await supabase
      .from("project")
      .select("workspace_id")
      .eq("id", job.project_id)
      .single();

    if (!project) continue;

    const { data: conn } = await supabase
      .from("api_connection")
      .select("encrypted_key")
      .eq("workspace_id", project.workspace_id)
      .eq("provider", "kieai")
      .eq("status", "connected")
      .single();

    if (!conn?.encrypted_key) continue;

    // Decrypt key for the poll request
    const { decryptApiKey } = await import("../services/crypto.js");
    let apiKey = decryptApiKey(Buffer.from(conn.encrypted_key, "base64"));

    try {
      const pollRes = await fetch(
        `${baseUrl}/api/v1/jobs/${job.provider_task_id}`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        }
      );

      // Clear key from memory
      apiKey = "";

      if (!pollRes.ok) continue;

      const body = await pollRes.json();
      const parsed = parseCallback(body);

      if (parsed.status === "succeeded") {
        await supabase
          .from("render_job")
          .update({
            status: "succeeded",
            actual_cost: parsed.cost,
            error_code: null,
            error_message: null,
            completed_at: new Date().toISOString(),
          })
          .eq("id", job.id);

        await supabase
          .from("project")
          .update({ status: "completed" })
          .eq("id", job.project_id);

        if (parsed.resultUrls.length > 0) {
          await supabase
            .from("render_version")
            .update({
              result_urls: parsed.resultUrls,
              task_id_provider: job.provider_task_id,
            })
            .eq("render_job_id", job.id);
        }

        results.push({
          jobId: job.id,
          taskId: job.provider_task_id,
          newStatus: "succeeded",
        });
      } else if (parsed.status === "failed") {
        await supabase
          .from("render_job")
          .update({
            status: "failed",
            error_code: parsed.errorCode,
            error_message: parsed.errorMessage,
            completed_at: new Date().toISOString(),
          })
          .eq("id", job.id);

        await supabase
          .from("project")
          .update({ status: "failed" })
          .eq("id", job.project_id);

        results.push({
          jobId: job.id,
          taskId: job.provider_task_id,
          newStatus: "failed",
        });
      }
      // If still processing, leave as-is
    } catch {
      apiKey = "";
      // Skip — will retry on next reconcile
    }
  }

  res.json({
    reconciled: results.length,
    total_inflight: jobs.length,
    details: results,
  });
});

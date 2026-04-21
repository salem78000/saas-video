import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middleware/auth.js";

export const renderRoutes = Router();

renderRoutes.use(requireAuth);

// Statuses that indicate an active (in-flight) job for a project
const ACTIVE_STATUSES = ["queued", "submitted", "processing", "retrying"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getWorkspaceForUser(userId: string) {
  const { data, error } = await supabase
    .from("workspace")
    .select("id")
    .eq("owner_id", userId)
    .single();
  if (error || !data) return null;
  return data;
}

async function projectBelongsToWorkspace(
  projectId: string,
  workspaceId: string
) {
  const { data, error } = await supabase
    .from("project")
    .select("id, workspace_id, provider, status")
    .eq("id", projectId)
    .eq("workspace_id", workspaceId)
    .single();
  if (error || !data) return null;
  return data;
}

/**
 * Returns the active render job for a project (queued/submitted/processing/retrying),
 * or null if none exists.
 */
async function findActiveJob(projectId: string) {
  const { data, error } = await supabase
    .from("render_job")
    .select("id, status, idempotency_key, created_at")
    .eq("project_id", projectId)
    .in("status", ACTIVE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// POST /api/renders — Submit a render job (idempotent)
// ---------------------------------------------------------------------------

const CreateRenderSchema = z.object({
  project_id: z.string().uuid(),
});

renderRoutes.post("/", async (req, res) => {
  const parsed = CreateRenderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "validation_error",
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { project_id } = parsed.data;

  // Resolve workspace + ownership
  const workspace = await getWorkspaceForUser(req.user!.id);
  if (!workspace) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }

  const project = await projectBelongsToWorkspace(project_id, workspace.id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  // Guard: project must be ready
  if (project.status !== "ready_for_render") {
    res.status(409).json({
      error: "project_not_ready",
      message: `Project status is '${project.status}', must be 'ready_for_render'`,
    });
    return;
  }

  // --- Idempotency check: reject if an active job already exists ---
  const existingJob = await findActiveJob(project_id);
  if (existingJob) {
    // Return the existing job instead of creating a duplicate
    res.status(409).json({
      error: "duplicate_job",
      message: "A render job is already active for this project",
      existing_job: {
        id: existingJob.id,
        status: existingJob.status,
        idempotency_key: existingJob.idempotency_key,
        created_at: existingJob.created_at,
      },
    });
    return;
  }

  // Generate idempotency key for this new submission
  const idempotencyKey = randomUUID();

  // Create the render job
  const { data: job, error: insertError } = await supabase
    .from("render_job")
    .insert({
      project_id,
      provider: project.provider ?? "kieai",
      status: "queued",
      idempotency_key: idempotencyKey,
      retry_count: 0,
      max_retries: 3,
    })
    .select(
      "id, project_id, provider, status, idempotency_key, estimated_cost, retry_count, max_retries, error_code, error_message, created_at"
    )
    .single();

  if (insertError) {
    // Handle unique constraint violation on idempotency_key (race condition)
    if (insertError.code === "23505") {
      res.status(409).json({
        error: "duplicate_job",
        message: "Concurrent submission detected, please retry",
      });
      return;
    }
    res.status(500).json({ error: "Failed to create render job" });
    return;
  }

  // Update project status to 'rendering'
  await supabase
    .from("project")
    .update({ status: "rendering" })
    .eq("id", project_id);

  res.status(201).json({ job });
});

// ---------------------------------------------------------------------------
// GET /api/renders/:id — Get render job status
// ---------------------------------------------------------------------------

renderRoutes.get("/:id", async (req, res) => {
  const { id } = req.params;

  const workspace = await getWorkspaceForUser(req.user!.id);
  if (!workspace) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }

  const { data: job, error } = await supabase
    .from("render_job")
    .select(
      "id, project_id, provider, status, idempotency_key, provider_task_id, estimated_cost, actual_cost, retry_count, max_retries, error_code, error_message, callback_url, submitted_at, processing_at, completed_at, created_at, updated_at"
    )
    .eq("id", id)
    .single();

  if (error || !job) {
    res.status(404).json({ error: "Render job not found" });
    return;
  }

  // Verify the job's project belongs to the user's workspace
  const project = await projectBelongsToWorkspace(
    job.project_id,
    workspace.id
  );
  if (!project) {
    res.status(404).json({ error: "Render job not found" });
    return;
  }

  res.json({ job });
});

// ---------------------------------------------------------------------------
// GET /api/renders/project/:projectId — List jobs for a project
// ---------------------------------------------------------------------------

renderRoutes.get("/project/:projectId", async (req, res) => {
  const { projectId } = req.params;

  const workspace = await getWorkspaceForUser(req.user!.id);
  if (!workspace) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }

  const project = await projectBelongsToWorkspace(projectId, workspace.id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const { data: jobs, error } = await supabase
    .from("render_job")
    .select(
      "id, project_id, provider, status, idempotency_key, provider_task_id, estimated_cost, actual_cost, retry_count, error_code, error_message, submitted_at, completed_at, created_at"
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) {
    res.status(500).json({ error: "Failed to fetch render jobs" });
    return;
  }

  res.json({ jobs: jobs ?? [] });
});

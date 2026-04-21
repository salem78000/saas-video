import { Router } from "express";
import { z } from "zod";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middleware/auth.js";

export const shotRoutes = Router();

shotRoutes.use(requireAuth);

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

async function projectBelongsToUser(projectId: string, userId: string) {
  const workspace = await getWorkspaceForUser(userId);
  if (!workspace) return false;
  const { data } = await supabase
    .from("project")
    .select("id")
    .eq("id", projectId)
    .eq("workspace_id", workspace.id)
    .single();
  return !!data;
}

const SHOT_COLUMNS =
  "id, project_id, order_index, prompt, duration_s, element_refs, is_valid, validation_errors, created_at, updated_at";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const CreateShotSchema = z.object({
  project_id: z.string().uuid(),
  prompt: z.string().max(500).default(""),
  duration_s: z.number().min(1).max(12).default(5),
  order_index: z.number().int().min(0),
  element_refs: z.array(z.string()).default([]),
});

const UpdateShotSchema = z.object({
  prompt: z.string().max(500).optional(),
  duration_s: z.number().min(1).max(12).optional(),
  element_refs: z.array(z.string()).optional(),
});

const ReorderSchema = z.object({
  project_id: z.string().uuid(),
  shot_ids: z.array(z.string().uuid()).min(1),
});

// ---------------------------------------------------------------------------
// GET /api/shots?project_id=xxx
// ---------------------------------------------------------------------------

shotRoutes.get("/", async (req, res) => {
  const projectId = req.query.project_id as string;
  if (!projectId) {
    res.status(400).json({ error: "project_id query parameter required" });
    return;
  }

  if (!(await projectBelongsToUser(projectId, req.user!.id))) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const { data, error } = await supabase
    .from("shot_plan")
    .select(SHOT_COLUMNS)
    .eq("project_id", projectId)
    .order("order_index", { ascending: true });

  if (error) { res.status(500).json({ error: "Failed to fetch shots" }); return; }
  res.json({ shots: data ?? [] });
});

// ---------------------------------------------------------------------------
// POST /api/shots
// ---------------------------------------------------------------------------

shotRoutes.post("/", async (req, res) => {
  const parsed = CreateShotSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", details: parsed.error.flatten().fieldErrors });
    return;
  }

  if (!(await projectBelongsToUser(parsed.data.project_id, req.user!.id))) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  // Validate shot
  const validationErrors: string[] = [];
  if (parsed.data.prompt.length > 500) validationErrors.push("Prompt exceeds 500 characters");
  if (parsed.data.duration_s < 1 || parsed.data.duration_s > 12) validationErrors.push("Duration must be 1-12s");

  const { data, error } = await supabase
    .from("shot_plan")
    .insert({
      project_id: parsed.data.project_id,
      prompt: parsed.data.prompt,
      duration_s: parsed.data.duration_s,
      order_index: parsed.data.order_index,
      element_refs: parsed.data.element_refs,
      is_valid: validationErrors.length === 0 && parsed.data.prompt.length > 0,
      validation_errors: validationErrors,
    })
    .select(SHOT_COLUMNS)
    .single();

  if (error) {
    // Handle unique constraint on (project_id, order_index)
    if (error.code === "23505") {
      res.status(409).json({ error: "Shot at this order_index already exists" });
      return;
    }
    res.status(500).json({ error: "Failed to create shot" });
    return;
  }

  res.status(201).json({ shot: data });
});

// ---------------------------------------------------------------------------
// PATCH /api/shots/reorder — bulk reorder (must be before /:id)
// ---------------------------------------------------------------------------

shotRoutes.patch("/reorder", async (req, res) => {
  const parsed = ReorderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", details: parsed.error.flatten().fieldErrors });
    return;
  }

  if (!(await projectBelongsToUser(parsed.data.project_id, req.user!.id))) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  // Use temporary negative indices to avoid unique constraint conflicts
  for (let i = 0; i < parsed.data.shot_ids.length; i++) {
    await supabase
      .from("shot_plan")
      .update({ order_index: -(i + 1) })
      .eq("id", parsed.data.shot_ids[i])
      .eq("project_id", parsed.data.project_id);
  }
  for (let i = 0; i < parsed.data.shot_ids.length; i++) {
    await supabase
      .from("shot_plan")
      .update({ order_index: i })
      .eq("id", parsed.data.shot_ids[i])
      .eq("project_id", parsed.data.project_id);
  }

  const { data, error } = await supabase
    .from("shot_plan")
    .select(SHOT_COLUMNS)
    .eq("project_id", parsed.data.project_id)
    .order("order_index", { ascending: true });

  if (error) { res.status(500).json({ error: "Failed to reorder shots" }); return; }
  res.json({ shots: data ?? [] });
});

// ---------------------------------------------------------------------------
// PATCH /api/shots/:id — autosave
// ---------------------------------------------------------------------------

shotRoutes.patch("/:id", async (req, res) => {
  const parsed = UpdateShotSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", details: parsed.error.flatten().fieldErrors });
    return;
  }

  // Fetch shot to check ownership
  const { data: shot } = await supabase
    .from("shot_plan")
    .select("id, project_id, prompt, duration_s")
    .eq("id", req.params.id)
    .single();

  if (!shot || !(await projectBelongsToUser(shot.project_id, req.user!.id))) {
    res.status(404).json({ error: "Shot not found" });
    return;
  }

  // Merge for validation
  const newPrompt = parsed.data.prompt ?? shot.prompt;
  const newDuration = parsed.data.duration_s ?? shot.duration_s;

  const validationErrors: string[] = [];
  if (newPrompt.length > 500) validationErrors.push("Prompt exceeds 500 characters");
  if (newDuration < 1 || newDuration > 12) validationErrors.push("Duration must be 1-12s");

  const { data, error } = await supabase
    .from("shot_plan")
    .update({
      ...parsed.data,
      is_valid: validationErrors.length === 0 && newPrompt.length > 0,
      validation_errors: validationErrors,
    })
    .eq("id", req.params.id)
    .select(SHOT_COLUMNS)
    .single();

  if (error) { res.status(500).json({ error: "Failed to update shot" }); return; }
  res.json({ shot: data });
});

// ---------------------------------------------------------------------------
// DELETE /api/shots/:id
// ---------------------------------------------------------------------------

shotRoutes.delete("/:id", async (req, res) => {
  const { data: shot } = await supabase
    .from("shot_plan")
    .select("id, project_id")
    .eq("id", req.params.id)
    .single();

  if (!shot || !(await projectBelongsToUser(shot.project_id, req.user!.id))) {
    res.status(404).json({ error: "Shot not found" });
    return;
  }

  const { error } = await supabase.from("shot_plan").delete().eq("id", req.params.id);
  if (error) { res.status(500).json({ error: "Failed to delete shot" }); return; }
  res.json({ deleted: true });
});


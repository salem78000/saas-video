import { Router } from "express";
import { z } from "zod";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middleware/auth.js";

export const projectRoutes = Router();

projectRoutes.use(requireAuth);

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

const PROJECT_COLUMNS =
  "id, workspace_id, name, description, status, aspect_ratio, duration_total_s, mode, sound_enabled, entry_image_url, reference_elements, global_style, camera_constraints, continuity_score, wizard_step, wizard_completed, provider, budget_max, budget_spent, metadata, created_at, updated_at";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(200),
  aspect_ratio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
  mode: z.enum(["std", "pro"]).default("std"),
  sound_enabled: z.boolean().default(false),
});

const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  aspect_ratio: z.enum(["16:9", "9:16", "1:1"]).optional(),
  mode: z.enum(["std", "pro"]).optional(),
  sound_enabled: z.boolean().optional(),
  entry_image_url: z.string().nullable().optional(),
  reference_elements: z
    .array(
      z.object({
        name: z.string(),
        images: z.array(z.string()).min(1).max(4),
      })
    )
    .max(3)
    .optional(),
  global_style: z.string().max(2000).nullable().optional(),
  camera_constraints: z.string().max(1000).nullable().optional(),
  continuity_score: z.enum(["low", "medium", "high"]).optional(),
  wizard_step: z.number().int().min(1).max(6).optional(),
  wizard_completed: z.boolean().optional(),
  provider: z.enum(["kieai", "veo", "runway", "luma"]).nullable().optional(),
  status: z
    .enum(["draft", "ready_for_render", "rendering", "completed", "failed"])
    .optional(),
  duration_total_s: z.number().positive().nullable().optional(),
});

// ---------------------------------------------------------------------------
// GET /api/projects
// ---------------------------------------------------------------------------

projectRoutes.get("/", async (req, res) => {
  const workspace = await getWorkspaceForUser(req.user!.id);
  if (!workspace) { res.status(404).json({ error: "Workspace not found" }); return; }

  const { data, error } = await supabase
    .from("project")
    .select(PROJECT_COLUMNS)
    .eq("workspace_id", workspace.id)
    .order("updated_at", { ascending: false });

  if (error) { res.status(500).json({ error: "Failed to fetch projects" }); return; }
  res.json({ projects: data ?? [] });
});

// ---------------------------------------------------------------------------
// POST /api/projects
// ---------------------------------------------------------------------------

projectRoutes.post("/", async (req, res) => {
  const parsed = CreateProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", details: parsed.error.flatten().fieldErrors });
    return;
  }

  const workspace = await getWorkspaceForUser(req.user!.id);
  if (!workspace) { res.status(404).json({ error: "Workspace not found" }); return; }

  const { data, error } = await supabase
    .from("project")
    .insert({
      workspace_id: workspace.id,
      name: parsed.data.name,
      aspect_ratio: parsed.data.aspect_ratio,
      mode: parsed.data.mode,
      sound_enabled: parsed.data.sound_enabled,
      status: "draft",
      wizard_step: 1,
    })
    .select(PROJECT_COLUMNS)
    .single();

  if (error) { res.status(500).json({ error: "Failed to create project" }); return; }
  res.status(201).json({ project: data });
});

// ---------------------------------------------------------------------------
// GET /api/projects/:id
// ---------------------------------------------------------------------------

projectRoutes.get("/:id", async (req, res) => {
  const workspace = await getWorkspaceForUser(req.user!.id);
  if (!workspace) { res.status(404).json({ error: "Workspace not found" }); return; }

  const { data, error } = await supabase
    .from("project")
    .select(PROJECT_COLUMNS)
    .eq("id", req.params.id)
    .eq("workspace_id", workspace.id)
    .single();

  if (error || !data) { res.status(404).json({ error: "Project not found" }); return; }
  res.json({ project: data });
});

// ---------------------------------------------------------------------------
// PATCH /api/projects/:id — autosave
// ---------------------------------------------------------------------------

projectRoutes.patch("/:id", async (req, res) => {
  const parsed = UpdateProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", details: parsed.error.flatten().fieldErrors });
    return;
  }

  const workspace = await getWorkspaceForUser(req.user!.id);
  if (!workspace) { res.status(404).json({ error: "Workspace not found" }); return; }

  const { data: existing } = await supabase
    .from("project")
    .select("id")
    .eq("id", req.params.id)
    .eq("workspace_id", workspace.id)
    .single();

  if (!existing) { res.status(404).json({ error: "Project not found" }); return; }

  const { data, error } = await supabase
    .from("project")
    .update(parsed.data)
    .eq("id", req.params.id)
    .select(PROJECT_COLUMNS)
    .single();

  if (error) { res.status(500).json({ error: "Failed to update project" }); return; }
  res.json({ project: data });
});

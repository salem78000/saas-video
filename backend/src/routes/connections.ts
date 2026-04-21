import { Router } from "express";
import { z } from "zod";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middleware/auth.js";
import { encryptApiKey, decryptApiKey } from "../services/crypto.js";
import { validateKieaiKey } from "../services/kieai.js";

export const connectionRoutes = Router();

// All routes require authentication
connectionRoutes.use(requireAuth);

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

const PROVIDERS = ["kieai", "veo", "runway", "luma"] as const;

const CreateConnectionSchema = z.object({
  provider: z.enum(PROVIDERS),
  api_key: z.string().min(1, "API key is required"),
});

function validateKeyFormat(
  provider: string,
  key: string
): { valid: true } | { valid: false; message: string } {
  if (provider === "kieai") {
    if (key.length < 10) {
      return {
        valid: false,
        message: "Kie.ai key must be at least 10 characters",
      };
    }
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// GET /api/connections — List workspace connections (never returns encrypted_key)
// ---------------------------------------------------------------------------
connectionRoutes.get("/", async (req, res) => {
  const workspace = await getWorkspaceForUser(req.user!.id);
  if (!workspace) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }

  const { data, error } = await supabase
    .from("api_connection")
    .select(
      "id, workspace_id, provider, status, key_last_four, balance_cached, balance_checked_at, created_at, updated_at"
    )
    .eq("workspace_id", workspace.id);

  if (error) {
    res.status(500).json({ error: "Failed to fetch connections" });
    return;
  }

  res.json({ connections: data ?? [] });
});

// ---------------------------------------------------------------------------
// POST /api/connections — Create / update an API key
// ---------------------------------------------------------------------------
connectionRoutes.post("/", async (req, res) => {
  // 1. Zod validation
  const parsed = CreateConnectionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "validation_error",
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { provider, api_key } = parsed.data;

  // 2. Format check
  const formatResult = validateKeyFormat(provider, api_key);
  if (!formatResult.valid) {
    res.status(400).json({
      error: "invalid_key_format",
      message: formatResult.message,
    });
    return;
  }

  // Resolve workspace
  const workspace = await getWorkspaceForUser(req.user!.id);
  if (!workspace) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }

  // 3. Validate key with provider
  let balance: number = 0;
  if (provider === "kieai") {
    const validation = await validateKieaiKey(api_key);
    if (!validation.valid) {
      res.status(400).json({
        error: validation.errorCode,
        message: validation.message,
      });
      return;
    }
    balance = validation.balance;
  }

  // 4. Encrypt
  const encryptedKey = encryptApiKey(api_key);
  const keyLastFour = api_key.slice(-4);

  const selectColumns =
    "id, workspace_id, provider, status, key_last_four, balance_cached, balance_checked_at, created_at, updated_at";

  // 5. Check if a row already exists for this workspace+provider
  const { data: existing } = await supabase
    .from("api_connection")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("provider", provider)
    .maybeSingle();

  let data, error;
  if (existing) {
    // UPDATE existing connection
    ({ data, error } = await supabase
      .from("api_connection")
      .update({
        encrypted_key: encryptedKey.toString("base64"),
        key_last_four: keyLastFour,
        status: "connected",
        balance_cached: balance,
        balance_checked_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select(selectColumns)
      .single());
  } else {
    // INSERT new connection
    ({ data, error } = await supabase
      .from("api_connection")
      .insert({
        workspace_id: workspace.id,
        provider,
        encrypted_key: encryptedKey.toString("base64"),
        key_last_four: keyLastFour,
        status: "connected",
        balance_cached: balance,
        balance_checked_at: new Date().toISOString(),
      })
      .select(selectColumns)
      .single());
  }

  if (error) {
    res.status(500).json({ error: "Failed to save connection" });
    return;
  }

  // 6. Return without encrypted_key
  res.status(201).json({ connection: data });
});

// ---------------------------------------------------------------------------
// DELETE /api/connections/:id — Soft-delete: clear key, set disconnected
// ---------------------------------------------------------------------------
connectionRoutes.delete("/:id", async (req, res) => {
  const { id } = req.params;

  const workspace = await getWorkspaceForUser(req.user!.id);
  if (!workspace) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }

  // Verify ownership
  const { data: existing, error: fetchError } = await supabase
    .from("api_connection")
    .select("id, workspace_id")
    .eq("id", id)
    .eq("workspace_id", workspace.id)
    .single();

  if (fetchError || !existing) {
    res.status(404).json({ error: "Connection not found" });
    return;
  }

  // Soft delete: null out key, set disconnected
  const { data, error } = await supabase
    .from("api_connection")
    .update({
      encrypted_key: null,
      status: "disconnected",
      balance_cached: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(
      "id, workspace_id, provider, status, key_last_four, balance_cached, balance_checked_at, created_at, updated_at"
    )
    .single();

  if (error) {
    res.status(500).json({ error: "Failed to delete connection" });
    return;
  }

  res.json({ connection: data });
});

// ---------------------------------------------------------------------------
// POST /api/connections/:id/test — Re-test an existing key
// ---------------------------------------------------------------------------
connectionRoutes.post("/:id/test", async (req, res) => {
  const { id } = req.params;

  const workspace = await getWorkspaceForUser(req.user!.id);
  if (!workspace) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }

  // Fetch connection including encrypted_key for decryption
  const { data: connection, error: fetchError } = await supabase
    .from("api_connection")
    .select("id, workspace_id, provider, encrypted_key, status")
    .eq("id", id)
    .eq("workspace_id", workspace.id)
    .single();

  if (fetchError || !connection) {
    res.status(404).json({ error: "Connection not found" });
    return;
  }

  if (!connection.encrypted_key) {
    res.status(400).json({ error: "No API key stored for this connection" });
    return;
  }

  // Decrypt
  let plainKey = "";
  try {
    plainKey = decryptApiKey(
      Buffer.from(connection.encrypted_key, "base64")
    );
  } catch {
    res.status(500).json({ error: "Failed to decrypt stored key" });
    return;
  }

  // Validate with provider
  let newStatus: "connected" | "key_invalid" = "connected";
  let balance: number | null = null;

  if (connection.provider === "kieai") {
    const validation = await validateKieaiKey(plainKey);
    if (validation.valid) {
      balance = validation.balance;
    } else {
      newStatus = "key_invalid";
    }
  }

  // Clear plaintext from memory
  plainKey = "";

  // Update status and balance
  const { data: updated, error: updateError } = await supabase
    .from("api_connection")
    .update({
      status: newStatus,
      balance_cached: balance,
      balance_checked_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(
      "id, workspace_id, provider, status, key_last_four, balance_cached, balance_checked_at, created_at, updated_at"
    )
    .single();

  if (updateError) {
    res.status(500).json({ error: "Failed to update connection status" });
    return;
  }

  res.json({ connection: updated });
});

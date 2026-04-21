"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, CheckCircle2, XCircle, Loader2, RefreshCw, Trash2, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/cn";
import { apiFetch, ApiError } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Connection {
  id: string;
  provider: string;
  status: "connected" | "disconnected" | "key_invalid";
  key_last_four: string | null;
  balance_cached: number | null;
  balance_checked_at: string | null;
}

type FormState =
  | { step: "idle" }
  | { step: "validating" }
  | { step: "success"; balance: number | null }
  | { step: "error"; code: string; message: string };

// ---------------------------------------------------------------------------
// Error messages — spec §3 / §5 user-facing messages
// ---------------------------------------------------------------------------

const ERROR_MESSAGES: Record<string, string> = {
  invalid_key_format:
    "Le format de la clé est invalide. Elle doit contenir au moins 10 caractères.",
  invalid_api_key:
    "Ta clé Kie.ai est invalide ou expirée. Vérifie-la sur ton compte Kie.ai.",
  insufficient_balance:
    "Ton solde Kie.ai est insuffisant. Recharge ton compte et réessaie.",
  key_expired: "Ta clé Kie.ai a expiré. Génère une nouvelle clé depuis ton compte.",
  rate_limit_exceeded:
    "Trop de requêtes vers Kie.ai. Réessaie dans quelques secondes.",
  provider_error:
    "Kie.ai a rencontré une erreur technique. Réessaie dans un instant.",
  network_error:
    "Impossible de joindre Kie.ai. Vérifie ta connexion internet.",
};

function getErrorMessage(code: string, fallback?: string): string {
  return ERROR_MESSAGES[code] ?? fallback ?? "Une erreur inattendue est survenue.";
}

// ---------------------------------------------------------------------------
// Format validation (client-side, mirrors backend)
// ---------------------------------------------------------------------------

function validateKeyFormat(key: string): string | null {
  if (!key.trim()) return "La clé API est requise.";
  if (key.length < 10) return "La clé doit contenir au moins 10 caractères.";
  return null;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [formatError, setFormatError] = useState<string | null>(null);
  const [formState, setFormState] = useState<FormState>({ step: "idle" });

  // Test state per connection id
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ------ Fetch connections ------

  const fetchConnections = useCallback(async () => {
    try {
      const data = await apiFetch<{ connections: Connection[] }>("/api/connections");
      setConnections(data.connections);
    } catch {
      // silent — page will show empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  // ------ Submit new key ------

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Client-side format check
    const fmtErr = validateKeyFormat(apiKey);
    if (fmtErr) {
      setFormatError(fmtErr);
      return;
    }
    setFormatError(null);
    setFormState({ step: "validating" });

    try {
      const data = await apiFetch<{ connection: Connection }>("/api/connections", {
        method: "POST",
        body: JSON.stringify({ provider: "kieai", api_key: apiKey }),
      });

      setFormState({
        step: "success",
        balance: data.connection.balance_cached,
      });
      setApiKey("");
      setShowKey(false);
      await fetchConnections();
    } catch (err) {
      if (err instanceof ApiError) {
        setFormState({
          step: "error",
          code: err.code,
          message: getErrorMessage(err.code, err.message),
        });
      } else {
        setFormState({
          step: "error",
          code: "network_error",
          message: getErrorMessage("network_error"),
        });
      }
    }
  }

  // ------ Test existing key ------

  async function handleTest(id: string) {
    setTestingId(id);
    try {
      await apiFetch(`/api/connections/${id}/test`, { method: "POST" });
      await fetchConnections();
    } catch {
      // refresh anyway to show updated status
      await fetchConnections();
    } finally {
      setTestingId(null);
    }
  }

  // ------ Delete key ------

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await apiFetch(`/api/connections/${id}`, { method: "DELETE" });
      await fetchConnections();
    } catch {
      await fetchConnections();
    } finally {
      setDeletingId(null);
    }
  }

  // ------ Helpers ------

  const kieaiConnection = connections.find((c) => c.provider === "kieai");

  function handleKeyChange(value: string) {
    setApiKey(value);
    if (formatError) setFormatError(null);
    if (formState.step !== "idle") setFormState({ step: "idle" });
  }

  // ------ Render ------

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-2xl font-bold tracking-tight">Mes connexions</h1>
      <p className="mt-1 text-sm text-gray-400">
        Connecte ta clé API pour lancer des rendus vidéo.
      </p>

      {/* ---- Existing connection status ---- */}
      {!loading && kieaiConnection && kieaiConnection.status !== "disconnected" && (
        <div
          className={cn(
            "mt-8 rounded-lg border p-4",
            kieaiConnection.status === "connected"
              ? "border-emerald-800 bg-emerald-950/40"
              : "border-red-800 bg-red-950/40"
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {kieaiConnection.status === "connected" ? (
                <Wifi className="h-5 w-5 text-emerald-400" />
              ) : (
                <WifiOff className="h-5 w-5 text-red-400" />
              )}
              <div>
                <p className="text-sm font-medium">
                  Kie.ai
                  <span className="ml-2 text-gray-500">
                    ••••••••{kieaiConnection.key_last_four}
                  </span>
                </p>
                <p
                  className={cn(
                    "text-xs",
                    kieaiConnection.status === "connected"
                      ? "text-emerald-400"
                      : "text-red-400"
                  )}
                >
                  {kieaiConnection.status === "connected"
                    ? "Connecté"
                    : "Clé invalide"}
                  {kieaiConnection.balance_cached != null && (
                    <span className="ml-2 text-gray-400">
                      — {kieaiConnection.balance_cached} crédits
                    </span>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleTest(kieaiConnection.id)}
                disabled={testingId === kieaiConnection.id}
                className="rounded-md p-2 text-gray-400 hover:bg-white/5 hover:text-white disabled:opacity-50"
                title="Re-tester la clé"
              >
                {testingId === kieaiConnection.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </button>
              <button
                onClick={() => handleDelete(kieaiConnection.id)}
                disabled={deletingId === kieaiConnection.id}
                className="rounded-md p-2 text-gray-400 hover:bg-red-950 hover:text-red-400 disabled:opacity-50"
                title="Révoquer la clé"
              >
                {deletingId === kieaiConnection.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Add / Update key form ---- */}
      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <div>
          <label htmlFor="api-key" className="block text-sm font-medium text-gray-300">
            {kieaiConnection && kieaiConnection.status === "connected"
              ? "Remplacer la clé Kie.ai"
              : "Clé API Kie.ai"}
          </label>

          <div className="relative mt-1.5">
            <input
              id="api-key"
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => handleKeyChange(e.target.value)}
              placeholder="sk-xxxxxxxx"
              autoComplete="off"
              spellCheck={false}
              className={cn(
                "block w-full rounded-lg border bg-gray-900 px-3 py-2.5 pr-10 text-sm text-white placeholder-gray-600 outline-none transition",
                "focus:ring-2 focus:ring-indigo-500/40",
                formatError
                  ? "border-red-600"
                  : "border-gray-700 hover:border-gray-600"
              )}
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              tabIndex={-1}
            >
              {showKey ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>

          {formatError && (
            <p className="mt-1.5 text-xs text-red-400">{formatError}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={formState.step === "validating" || !apiKey.trim()}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition",
            "bg-indigo-600 text-white hover:bg-indigo-500",
            "disabled:cursor-not-allowed disabled:opacity-50"
          )}
        >
          {formState.step === "validating" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Vérification en cours…
            </>
          ) : (
            "Connecter"
          )}
        </button>
      </form>

      {/* ---- Result feedback ---- */}
      {formState.step === "success" && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-800 bg-emerald-950/40 p-3">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <div className="text-sm">
            <p className="font-medium text-emerald-300">Clé valide</p>
            {formState.balance != null && (
              <p className="text-emerald-400/80">
                Solde : {formState.balance} crédits
              </p>
            )}
          </div>
        </div>
      )}

      {formState.step === "error" && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-800 bg-red-950/40 p-3">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <p className="text-sm text-red-300">{formState.message}</p>
        </div>
      )}

      {/* ---- Loading skeleton ---- */}
      {loading && (
        <div className="mt-8 flex items-center justify-center py-12 text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}
    </div>
  );
}

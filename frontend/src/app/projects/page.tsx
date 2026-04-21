"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, Film, Clock } from "lucide-react";
import { cn } from "@/lib/cn";
import { apiFetch } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Project {
  id: string;
  name: string;
  status: string;
  aspect_ratio: "16:9" | "9:16" | "1:1";
  created_at: string;
  updated_at: string;
}

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  draft: { label: "Brouillon", cls: "bg-gray-700 text-gray-300" },
  ready_for_render: { label: "Prêt", cls: "bg-blue-900 text-blue-300" },
  rendering: { label: "En cours", cls: "bg-yellow-900 text-yellow-300" },
  succeeded: { label: "Terminé", cls: "bg-emerald-900 text-emerald-300" },
  failed: { label: "Échoué", cls: "bg-red-900 text-red-300" },
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ projects: Project[] }>("/api/projects")
      .then(({ projects: p }) => setProjects(p))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Mes projets</h1>
        <button
          type="button"
          onClick={() => router.push("/projects/new")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition",
            "bg-indigo-600 text-white hover:bg-indigo-500"
          )}
        >
          <Plus className="h-4 w-4" />
          Nouveau projet
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="mt-16 flex items-center justify-center py-12 text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!loading && projects.length === 0 && (
        <div className="mt-16 rounded-lg border border-gray-700 bg-gray-900 p-10 text-center">
          <Film className="mx-auto h-10 w-10 text-gray-600" />
          <p className="mt-4 text-sm text-gray-400">Aucun projet pour le moment.</p>
          <button
            type="button"
            onClick={() => router.push("/projects/new")}
            className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-indigo-400 hover:text-indigo-300"
          >
            <Plus className="h-4 w-4" />
            Créer mon premier projet
          </button>
        </div>
      )}

      {/* Project list */}
      {!loading && projects.length > 0 && (
        <div className="mt-8 space-y-3">
          {projects.map((p) => {
            const status = STATUS_CONFIG[p.status] ?? {
              label: p.status,
              cls: "bg-gray-700 text-gray-300",
            };
            return (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-lg border border-gray-700 bg-gray-900 p-4 transition hover:border-gray-600"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-white">
                      {p.name}
                    </p>
                    <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-gray-400 ring-1 ring-gray-700">
                      {p.aspect_ratio}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                        status.cls
                      )}
                    >
                      {status.label}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                    <Clock className="h-3 w-3" />
                    {new Date(p.created_at).toLocaleDateString("fr-FR")}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => router.push(`/projects/new?id=${p.id}`)}
                  className="ml-4 shrink-0 rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 transition hover:border-gray-500 hover:text-white"
                >
                  Continuer
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

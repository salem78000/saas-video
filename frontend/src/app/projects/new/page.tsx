"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plus,
  Trash2,
  GripVertical,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Check,
  AlertCircle,
  Image as ImageIcon,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Wifi,
  WifiOff,
  CircleDollarSign,
  Zap,
  Pencil,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  ShoppingBag,
  Briefcase,
  Sparkles,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { apiFetch, ApiError } from "@/lib/api";
import { useAutosave } from "@/hooks/useAutosave";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReferenceElement { name: string; images: string[] }

interface Project {
  id: string;
  name: string;
  description: string | null;
  status: string;
  aspect_ratio: "16:9" | "9:16" | "1:1";
  mode: "std" | "pro";
  sound_enabled: boolean;
  entry_image_url: string | null;
  reference_elements: ReferenceElement[];
  global_style: string | null;
  camera_constraints: string | null;
  continuity_score: "low" | "medium" | "high";
  wizard_step: number;
  duration_total_s: number | null;
  provider: string | null;
}

interface Shot {
  id: string;
  project_id: string;
  order_index: number;
  prompt: string;
  duration_s: number;
  element_refs: string[];
  is_valid: boolean;
  validation_errors: string[];
}

interface Connection {
  id: string;
  provider: string;
  status: "connected" | "disconnected" | "key_invalid";
  key_last_four: string | null;
  balance_cached: number | null;
}

interface RenderJob {
  id: string;
  status: string;
  provider_task_id: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ASPECT_RATIOS = [
  { value: "16:9", label: "16:9", desc: "Paysage" },
  { value: "9:16", label: "9:16", desc: "Vertical" },
  { value: "1:1", label: "1:1", desc: "Carré" },
] as const;

const MODES = [
  { value: "std", label: "Standard", desc: "Rapide, bon rapport qualité/coût" },
  { value: "pro", label: "Pro", desc: "Haute qualité, plus lent" },
] as const;

const MAX_PROMPT = 500;
const TOTAL_STEPS = 6;

const STATUS_LABELS: Record<string, { label: string; pct: number }> = {
  queued: { label: "En file d'attente", pct: 10 },
  submitted: { label: "Envoyé à Kie.ai", pct: 25 },
  processing: { label: "Génération en cours…", pct: 60 },
  retrying: { label: "Nouvel essai en cours…", pct: 50 },
  succeeded: { label: "Rendu terminé !", pct: 100 },
  failed: { label: "Échec du rendu", pct: 100 },
  cancelled: { label: "Annulé", pct: 100 },
};

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

interface TemplateShot { prompt: string; duration_s: number }

interface Template {
  id: string;
  name: string;
  description: string;
  icon: typeof ShoppingBag;
  aspectRatio: "16:9" | "9:16" | "1:1";
  mode: "std" | "pro";
  shots: TemplateShot[];
}

const TEMPLATES: Template[] = [
  {
    id: "ecommerce",
    name: "Vidéo promotionnelle e-commerce",
    description: "4 shots, 30s — Idéal pour mettre en valeur un produit avec un call-to-action percutant.",
    icon: ShoppingBag,
    aspectRatio: "16:9",
    mode: "std",
    shots: [
      { prompt: "Plan large sur le produit posé sur un fond épuré, éclairage studio doux, rotation lente de 45° pour révéler les détails du design. Ambiance premium et moderne.", duration_s: 8 },
      { prompt: "Zoom macro progressif sur les détails du produit : textures, matériaux, finitions. Éclairage latéral mettant en valeur les reliefs et la qualité de fabrication.", duration_s: 8 },
      { prompt: "Mise en situation lifestyle : une personne utilise le produit dans un cadre quotidien lumineux et chaleureux. Gestes naturels, sourire discret, intérieur soigné.", duration_s: 7 },
      { prompt: "Plan final avec le produit centré, apparition élégante du prix et d'un badge promotionnel. Fond dégradé subtil, appel à l'action clair et lisible.", duration_s: 7 },
    ],
  },
  {
    id: "b2b",
    name: "Présentation de service B2B",
    description: "3 shots, 20s — Structuré problème / solution / résultats pour convaincre un décideur.",
    icon: Briefcase,
    aspectRatio: "16:9",
    mode: "std",
    shots: [
      { prompt: "Scène d'un professionnel frustré devant son écran, graphiques en baisse, notifications qui s'accumulent. Ambiance bureau réaliste, éclairage froid, ton sérieux.", duration_s: 7 },
      { prompt: "Transition vers une interface moderne et fluide : le même professionnel découvre la solution, navigation intuitive, tableaux de bord clairs. Éclairage qui se réchauffe progressivement.", duration_s: 7 },
      { prompt: "Écran de résultats : graphiques en forte hausse, indicateurs au vert, équipe souriante en arrière-plan. Données chiffrées visibles (+40%, ROI x3). Ambiance positive et professionnelle.", duration_s: 6 },
    ],
  },
  {
    id: "lifestyle",
    name: "Vidéo produit lifestyle",
    description: "5 shots, 40s — Narration immersive du quotidien pour créer une connexion émotionnelle.",
    icon: Sparkles,
    aspectRatio: "16:9",
    mode: "std",
    shots: [
      { prompt: "Scène de vie quotidienne : matin lumineux, intérieur cosy, lumière dorée à travers les fenêtres. Ambiance calme et aspirationnelle, mouvements lents.", duration_s: 8 },
      { prompt: "Découverte du produit : une main le saisit délicatement sur une table en bois. Gros plan sur l'objet, reflets de lumière naturelle, curiosité palpable.", duration_s: 8 },
      { prompt: "Utilisation naturelle du produit dans le quotidien : gestes fluides et authentiques, environnement soigné mais réaliste. Caméra qui suit le mouvement en dolly léger.", duration_s: 8 },
      { prompt: "Réaction positive : sourire spontané, moment de satisfaction visible. Lumière chaude enveloppante, profondeur de champ faible pour isoler l'émotion.", duration_s: 8 },
      { prompt: "Plan final élégant : le produit reposé dans son environnement, composition soignée, lumière dorée du soir. Ambiance premium, plan fixe contemplatif.", duration_s: 8 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function NewProjectWizardPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-gray-500" /></div>}>
      <NewProjectWizard />
    </Suspense>
  );
}

function NewProjectWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [created, setCreated] = useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(!searchParams.get("id"));
  const pendingTemplateShots = useRef<TemplateShot[] | null>(null);

  // Step 1
  const [name, setName] = useState("Nouveau projet");
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [mode, setMode] = useState<"std" | "pro">("std");
  const [soundEnabled, setSoundEnabled] = useState(false);

  // Step 2
  const [entryImageUrl, setEntryImageUrl] = useState("");
  const [globalStyle, setGlobalStyle] = useState("");
  const [cameraConstraints, setCameraConstraints] = useState("");
  const [elements, setElements] = useState<ReferenceElement[]>([]);

  // Step 3 drag
  const dragIdx = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Step 3 debounced shot saves (per-shot timers)
  const shotSaveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Step 4
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  // Step 5
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Step 6
  const [renderJob, setRenderJob] = useState<RenderJob | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // =========================================================================
  // Refs — keep latest values accessible without re-creating callbacks
  // =========================================================================

  const projectRef = useRef(project);
  projectRef.current = project;

  const shotsRef = useRef(shots);
  shotsRef.current = shots;

  const formRef = useRef({
    name, aspectRatio, mode, soundEnabled,
    entryImageUrl, globalStyle, cameraConstraints, elements,
    step, selectedProvider,
  });
  formRef.current = {
    name, aspectRatio, mode, soundEnabled,
    entryImageUrl, globalStyle, cameraConstraints, elements,
    step, selectedProvider,
  };

  // Last-saved snapshot for change detection
  const lastSavedRef = useRef("");

  // =========================================================================
  // Autosave — stable function, reads from refs, skips if unchanged
  // =========================================================================

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const saveProject = useCallback(async () => {
    const p = projectRef.current;
    if (!p) return;

    const f = formRef.current;
    const s = shotsRef.current;

    const hasEntry = !!f.entryImageUrl.trim();
    const hasStyle = !!f.globalStyle.trim();
    const hasRefs = f.elements.length > 0;
    const hasCam = !!f.cameraConstraints.trim();
    let cs: "low" | "medium" | "high" = "low";
    if (hasEntry && hasStyle && hasRefs && hasCam) cs = "high";
    else if (hasEntry && hasStyle) cs = "medium";

    const payload = {
      name: f.name,
      aspect_ratio: f.aspectRatio,
      mode: f.mode,
      sound_enabled: f.soundEnabled,
      entry_image_url: f.entryImageUrl.trim() || null,
      reference_elements: f.elements,
      global_style: f.globalStyle.trim() || null,
      camera_constraints: f.cameraConstraints.trim() || null,
      continuity_score: cs,
      wizard_step: f.step,
      provider: f.selectedProvider,
      duration_total_s: s.length > 0 ? s.reduce((sum, sh) => sum + sh.duration_s, 0) : null,
    };

    // Skip if nothing changed since last save
    const snapshot = JSON.stringify(payload);
    if (snapshot === lastSavedRef.current) return;

    setSaving(true);
    try {
      const { project: u } = await apiFetch<{ project: Project }>(
        `/api/projects/${p.id}`,
        { method: "PATCH", body: snapshot }
      );
      projectRef.current = u;
      setProject(u);
      lastSavedRef.current = snapshot;
    } catch {} finally {
      setSaving(false);
    }
  }, []); // EMPTY — reads everything from refs

  const triggerAutosave = useAutosave(saveProject);

  // =========================================================================
  // Load existing project from ?id=xxx
  // =========================================================================

  useEffect(() => {
    const id = searchParams.get("id");
    if (!id) return;

    (async () => {
      setSaving(true);
      try {
        const [{ project: p }, { shots: s }] = await Promise.all([
          apiFetch<{ project: Project }>(`/api/projects/${id}`),
          apiFetch<{ shots: Shot[] }>(`/api/shots?project_id=${id}`),
        ]);
        setProject(p);
        projectRef.current = p;
        setName(p.name);
        setAspectRatio(p.aspect_ratio);
        setMode(p.mode);
        setSoundEnabled(p.sound_enabled);
        setEntryImageUrl(p.entry_image_url ?? "");
        setGlobalStyle(p.global_style ?? "");
        setCameraConstraints(p.camera_constraints ?? "");
        setElements(p.reference_elements ?? []);
        setSelectedProvider(p.provider);
        setShots(s);
        setCreated(true);
        setStep(p.wizard_step || 2);
      } catch {} finally {
        setSaving(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // =========================================================================
  // Step 1 — Create
  // =========================================================================

  async function createProject() {
    setSaving(true);
    try {
      const { project: p } = await apiFetch<{ project: Project }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name, aspect_ratio: aspectRatio, mode, sound_enabled: soundEnabled }),
      });
      setProject(p);
      projectRef.current = p;
      setCreated(true);

      const tplShots = pendingTemplateShots.current;
      const shotsToCreate = tplShots && tplShots.length > 0
        ? tplShots.map((s, i) => ({ project_id: p.id, prompt: s.prompt, duration_s: s.duration_s, order_index: i }))
        : [{ project_id: p.id, prompt: "", duration_s: 5, order_index: 0 }, { project_id: p.id, prompt: "", duration_s: 5, order_index: 1 }];
      pendingTemplateShots.current = null;

      const newShots: Shot[] = [];
      for (const payload of shotsToCreate) {
        const { shot } = await apiFetch<{ shot: Shot }>("/api/shots", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        newShots.push(shot);
      }
      setShots(newShots);
      setStep(2);
    } catch {} finally { setSaving(false); }
  }

  // =========================================================================
  // Step 3 — Shots
  // =========================================================================

  async function addShot() {
    if (!projectRef.current) return;
    try {
      const { shot } = await apiFetch<{ shot: Shot }>("/api/shots", {
        method: "POST",
        body: JSON.stringify({ project_id: projectRef.current.id, prompt: "", duration_s: 5, order_index: shotsRef.current.length }),
      });
      setShots((p) => [...p, shot]);
      triggerAutosave();
    } catch {}
  }

  async function deleteShot(id: string) {
    try {
      await apiFetch(`/api/shots/${id}`, { method: "DELETE" });
      setShots((p) => p.filter((s) => s.id !== id));
      triggerAutosave();
    } catch {}
  }

  function updateShot(id: string, patch: Partial<Pick<Shot, "prompt" | "duration_s">>) {
    // Optimistic local update only — no project autosave triggered
    setShots((p) => p.map((s) => (s.id === id ? { ...s, ...patch } : s)));

    // Debounce the shot PATCH API call (per shot)
    const existing = shotSaveTimers.current.get(id);
    if (existing) clearTimeout(existing);
    shotSaveTimers.current.set(
      id,
      setTimeout(async () => {
        shotSaveTimers.current.delete(id);
        try {
          const { shot } = await apiFetch<{ shot: Shot }>(`/api/shots/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
          setShots((p) => p.map((s) => (s.id === id ? shot : s)));
        } catch {}
      }, 800)
    );
  }

  async function handleReorder(from: number, to: number) {
    if (from === to || !projectRef.current) return;
    const r = [...shots]; const [m] = r.splice(from, 1); r.splice(to, 0, m);
    setShots(r);
    try {
      const { shots: u } = await apiFetch<{ shots: Shot[] }>("/api/shots/reorder", {
        method: "PATCH", body: JSON.stringify({ project_id: projectRef.current.id, shot_ids: r.map((s) => s.id) }),
      });
      setShots(u);
      triggerAutosave();
    } catch {}
  }

  // =========================================================================
  // Step 4 — Fetch connections
  // =========================================================================

  useEffect(() => {
    if (step === 4) {
      apiFetch<{ connections: Connection[] }>("/api/connections")
        .then(({ connections: c }) => {
          setConnections(c);
          const connected = c.filter((x) => x.status === "connected");
          if (connected.length === 1) setSelectedProvider(connected[0].provider);
          else if (selectedProvider === null && connected.length > 0) setSelectedProvider(connected[0].provider);
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // =========================================================================
  // Step 5 — Validation & balance
  // =========================================================================

  const estimatedCost = shots.reduce((s, sh) => s + sh.duration_s, 0) * (mode === "pro" ? 2 : 1);

  const validationChecks = useCallback(() => {
    const checks: Array<{ ok: boolean; label: string; fixStep: number }> = [];
    checks.push({ ok: !!name.trim(), label: "Nom du projet renseigné", fixStep: 1 });
    checks.push({ ok: !!entryImageUrl.trim(), label: "Image d'entrée fournie", fixStep: 2 });
    checks.push({ ok: shots.length >= 1, label: "Au moins 1 shot défini", fixStep: 3 });
    checks.push({ ok: shots.every((s) => s.prompt.length > 0 && s.prompt.length <= MAX_PROMPT), label: "Tous les prompts renseignés (max 500 car.)", fixStep: 3 });
    checks.push({ ok: shots.every((s) => s.duration_s >= 1 && s.duration_s <= 12), label: "Durées valides (1-12s par shot)", fixStep: 3 });
    checks.push({ ok: !!selectedProvider, label: "Provider sélectionné", fixStep: 4 });
    const conn = connections.find((c) => c.provider === selectedProvider);
    checks.push({ ok: !!conn && conn.status === "connected", label: "Clé API connectée et valide", fixStep: 4 });
    checks.push({ ok: balance !== null && balance >= estimatedCost, label: "Solde suffisant", fixStep: 4 });
    return checks;
  }, [name, entryImageUrl, shots, selectedProvider, connections, balance, estimatedCost]);

  // Read balance from cached connection data — no API call needed
  useEffect(() => {
    if (step !== 5) return;
    const conn = connections.find((c) => c.provider === selectedProvider);
    setBalance(conn?.balance_cached ?? null);
    setBalanceLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const checks = validationChecks();
  const allValid = checks.every((c) => c.ok);

  // =========================================================================
  // Step 5 — Submit render
  // =========================================================================

  async function handleGenerate() {
    if (!project || !allValid) return;
    setSubmitting(true);
    try {
      // Mark project ready
      await apiFetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "ready_for_render", wizard_completed: true, wizard_step: 6 }),
      });
      // Submit render
      const { job } = await apiFetch<{ job: RenderJob }>("/api/renders", {
        method: "POST",
        body: JSON.stringify({ project_id: project.id }),
      });
      setRenderJob(job);
      setStep(6);
    } catch (err) {
      if (err instanceof ApiError) {
        alert(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  // =========================================================================
  // Step 6 — Polling
  // =========================================================================

  useEffect(() => {
    if (step !== 6 || !renderJob) return;
    const terminal = ["succeeded", "failed", "cancelled"];
    if (terminal.includes(renderJob.status)) return;

    pollRef.current = setInterval(async () => {
      try {
        const { job } = await apiFetch<{ job: RenderJob }>(`/api/renders/${renderJob.id}`);
        setRenderJob(job);
        if (terminal.includes(job.status) && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch {}
    }, 4000);

    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [step, renderJob?.id, renderJob?.status]);

  // =========================================================================
  // Navigation
  // =========================================================================

  function handleNext() {
    if (step === 1 && !created) { createProject(); return; }
    if (step < 6) { saveProject(); setStep(step + 1); }
  }
  function handleBack() {
    if (step > 1 && step < 6) { saveProject(); setStep(step - 1); }
  }

  // Autosave trigger for step 2 fields only — stable deps, no shots/project
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (created) triggerAutosave();
  }, [entryImageUrl, globalStyle, cameraConstraints, elements, created]);

  // =========================================================================
  // Computed
  // =========================================================================

  const totalDuration = shots.reduce((s, sh) => s + sh.duration_s, 0);
  const continuityScore = (() => {
    const e = !!entryImageUrl.trim(), s = !!globalStyle.trim(), r = elements.length > 0, c = !!cameraConstraints.trim();
    if (e && s && r && c) return "high"; if (e && s) return "medium"; return "low";
  })();
  const scoreConfig = {
    low: { icon: ShieldAlert, color: "text-orange-400", bg: "bg-orange-950/40 border-orange-800", label: "Faible", desc: "Risque de discontinuité visuelle élevé" },
    medium: { icon: Shield, color: "text-yellow-400", bg: "bg-yellow-950/40 border-yellow-800", label: "Correct", desc: "Continuité visuelle acceptable" },
    high: { icon: ShieldCheck, color: "text-emerald-400", bg: "bg-emerald-950/40 border-emerald-800", label: "Fort", desc: "Bonne cohérence visuelle" },
  };
  const sc = scoreConfig[continuityScore];

  const renderStatus = renderJob ? (STATUS_LABELS[renderJob.status] ?? { label: renderJob.status, pct: 0 }) : null;

  // =========================================================================
  // Template selection
  // =========================================================================

  function selectTemplate(tpl: Template) {
    setName(tpl.name);
    setAspectRatio(tpl.aspectRatio);
    setMode(tpl.mode);
    pendingTemplateShots.current = tpl.shots;
    setShowTemplateSelector(false);
  }

  function skipTemplate() {
    setShowTemplateSelector(false);
  }

  // =========================================================================
  // Render
  // =========================================================================

  if (showTemplateSelector) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">Nouveau projet</h1>
          <p className="mt-1 text-sm text-gray-400">Choisis un template pour démarrer plus vite, ou pars de zéro.</p>
        </div>

        <div className="space-y-3">
          {TEMPLATES.map((tpl) => {
            const Icon = tpl.icon;
            const totalDur = tpl.shots.reduce((s, sh) => s + sh.duration_s, 0);
            return (
              <button
                key={tpl.id}
                type="button"
                onClick={() => selectTemplate(tpl)}
                className="flex w-full items-start gap-4 rounded-lg border border-gray-700 bg-gray-900 p-5 text-left transition hover:border-indigo-500 hover:bg-indigo-950/20"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-950/60">
                  <Icon className="h-5 w-5 text-indigo-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white">{tpl.name}</p>
                  <p className="mt-1 text-xs text-gray-400">{tpl.description}</p>
                  <div className="mt-2 flex items-center gap-3 text-[11px] text-gray-500">
                    <span>{tpl.shots.length} shots</span>
                    <span>{totalDur}s</span>
                    <span>{tpl.aspectRatio}</span>
                    <span>{tpl.mode === "pro" ? "Pro" : "Standard"}</span>
                  </div>
                </div>
                <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-gray-600" />
              </button>
            );
          })}

          {/* From scratch */}
          <button
            type="button"
            onClick={skipTemplate}
            className="flex w-full items-center gap-4 rounded-lg border border-dashed border-gray-700 bg-gray-950/50 p-5 text-left transition hover:border-gray-500 hover:bg-gray-900"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-800">
              <FileText className="h-5 w-5 text-gray-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-300">Partir de zéro</p>
              <p className="mt-1 text-xs text-gray-500">Commence avec un projet vierge et configure tout manuellement.</p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-600" />
          </button>
        </div>

        {/* Back to projects */}
        <div className="mt-8">
          <button
            type="button"
            onClick={() => router.push("/projects")}
            className="flex items-center gap-1 text-sm text-gray-500 transition hover:text-gray-300"
          >
            <ChevronLeft className="h-4 w-4" />
            Retour aux projets
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{step === 6 ? "Suivi du rendu" : "Nouveau projet"}</h1>
          <p className="mt-1 text-sm text-gray-400">Étape {step} sur {TOTAL_STEPS}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          {saving ? "Sauvegarde…" : created ? "Sauvegardé" : ""}
        </div>
      </div>

      {/* Step bar */}
      <div className="mb-8 flex gap-1">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <div key={i} className={cn("h-1 flex-1 rounded-full transition-colors", i < step ? "bg-indigo-500" : "bg-gray-800")} />
        ))}
      </div>

      {/* ============= STEP 1 ============= */}
      {step === 1 && (
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-300">Nom du projet</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 block w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white outline-none transition hover:border-gray-600 focus:ring-2 focus:ring-indigo-500/40" placeholder="Mon projet vidéo" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300">Format</label>
            <p className="mb-2 text-xs text-gray-500">Verrouillé après cette étape</p>
            <div className="flex gap-3">
              {ASPECT_RATIOS.map((ar) => (
                <button key={ar.value} type="button" onClick={() => !created && setAspectRatio(ar.value)} disabled={created} className={cn("flex-1 rounded-lg border px-4 py-3 text-center text-sm transition", aspectRatio === ar.value ? "border-indigo-500 bg-indigo-950/40 text-white" : "border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600", created && "cursor-not-allowed opacity-60")}>
                  <span className="font-medium">{ar.label}</span><br /><span className="text-xs text-gray-500">{ar.desc}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300">Mode de rendu</label>
            <div className="mt-1.5 flex gap-3">
              {MODES.map((m) => (
                <button key={m.value} type="button" onClick={() => setMode(m.value)} className={cn("flex-1 rounded-lg border px-4 py-3 text-center text-sm transition", mode === m.value ? "border-indigo-500 bg-indigo-950/40 text-white" : "border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600")}>
                  <span className="font-medium">{m.label}</span><br /><span className="text-xs text-gray-500">{m.desc}</span>
                </button>
              ))}
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-3">
            <input type="checkbox" checked={soundEnabled} onChange={(e) => setSoundEnabled(e.target.checked)} className="h-4 w-4 rounded border-gray-600 bg-gray-900 text-indigo-500 focus:ring-indigo-500/40" />
            <span className="text-sm text-gray-300">Activer la génération sonore</span>
          </label>
        </div>
      )}

      {/* ============= STEP 2 ============= */}
      {step === 2 && (
        <div className="space-y-6">
          <div className={cn("flex items-center gap-3 rounded-lg border p-3", sc.bg)}>
            <sc.icon className={cn("h-5 w-5", sc.color)} />
            <div>
              <p className={cn("text-sm font-medium", sc.color)}>Cohérence : {sc.label}</p>
              <p className="text-xs text-gray-400">{sc.desc}</p>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300">Image d&apos;entrée <span className="text-red-400">*</span></label>
            <p className="mb-1.5 text-xs text-gray-500">Obligatoire en multi-shot. Première frame de la vidéo.</p>
            <input value={entryImageUrl} onChange={(e) => setEntryImageUrl(e.target.value)} placeholder="https://… URL de l'image" className="block w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white placeholder-gray-600 outline-none transition hover:border-gray-600 focus:ring-2 focus:ring-indigo-500/40" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300">Style global</label>
            <textarea value={globalStyle} onChange={(e) => setGlobalStyle(e.target.value)} rows={2} placeholder="Ex : cinématique, éclairage chaud, grain film 35mm…" className="mt-1.5 block w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white placeholder-gray-600 outline-none transition hover:border-gray-600 focus:ring-2 focus:ring-indigo-500/40" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300">Contraintes caméra</label>
            <textarea value={cameraConstraints} onChange={(e) => setCameraConstraints(e.target.value)} rows={2} placeholder="Ex : pas de mouvement brusque, dolly lent…" className="mt-1.5 block w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white placeholder-gray-600 outline-none transition hover:border-gray-600 focus:ring-2 focus:ring-indigo-500/40" />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-300">Éléments de référence ({elements.length}/3)</label>
              {elements.length < 3 && (
                <button type="button" onClick={() => setElements((p) => [...p, { name: `ref_${String(p.length + 1).padStart(2, "0")}`, images: [] }])} className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300"><Plus className="h-3 w-3" /> Ajouter</button>
              )}
            </div>
            {elements.length === 0 && <p className="mt-2 text-xs text-gray-500">Aucun élément ajouté. Optionnel mais améliore la cohérence.</p>}
            <div className="mt-2 space-y-3">
              {elements.map((el, i) => (
                <div key={i} className="rounded-lg border border-gray-700 bg-gray-900 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2"><ImageIcon className="h-4 w-4 text-gray-500" /><span className="text-sm font-medium text-gray-300">{el.name}</span><span className="text-xs text-gray-500">({el.images.length}/4 images)</span></div>
                    <button type="button" onClick={() => setElements((p) => p.filter((_, j) => j !== i))} className="text-gray-500 hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                  {el.images.length < 4 && (
                    <input placeholder="Coller une URL d'image et appuyer Entrée" className="mt-2 block w-full rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-white placeholder-gray-600 outline-none focus:ring-1 focus:ring-indigo-500/40" onKeyDown={(e) => { if (e.key === "Enter") { const v = (e.target as HTMLInputElement).value.trim(); if (!v) return; setElements((p) => p.map((el2, j) => j === i ? { ...el2, images: [...el2.images, v] } : el2)); (e.target as HTMLInputElement).value = ""; } }} />
                  )}
                  {el.images.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {el.images.map((url, k) => (
                        <span key={k} className="flex items-center gap-1 rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
                          {url.length > 30 ? url.slice(0, 30) + "…" : url}
                          <button type="button" onClick={() => setElements((p) => p.map((el2, j) => j === i ? { ...el2, images: el2.images.filter((_, m2) => m2 !== k) } : el2))} className="ml-1 text-gray-500 hover:text-red-400">×</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ============= STEP 3 ============= */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-gray-700 bg-gray-900 px-4 py-2.5 text-sm">
            <span className="text-gray-400">{shots.length} shot{shots.length > 1 ? "s" : ""} — durée totale <span className="font-medium text-white">{totalDuration}s</span></span>
            <button type="button" onClick={addShot} className="flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500"><Plus className="h-3 w-3" /> Ajouter un shot</button>
          </div>
          <div className="space-y-2">
            {shots.map((shot, idx) => {
              const cc = shot.prompt.length;
              const over = cc > MAX_PROMPT;
              return (
                <div key={shot.id} draggable onDragStart={() => { dragIdx.current = idx; }} onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx); }} onDragLeave={() => setDragOverIdx(null)} onDrop={() => { if (dragIdx.current !== null) handleReorder(dragIdx.current, idx); dragIdx.current = null; setDragOverIdx(null); }} onDragEnd={() => { dragIdx.current = null; setDragOverIdx(null); }} className={cn("rounded-lg border bg-gray-900 p-3 transition-colors", dragOverIdx === idx ? "border-indigo-500" : "border-gray-700")}>
                  <div className="mb-2 flex items-center gap-2">
                    <GripVertical className="h-4 w-4 cursor-grab text-gray-600 active:cursor-grabbing" />
                    <span className="text-xs font-medium text-gray-400">Shot {idx + 1}</span>
                    <div className="ml-auto flex items-center gap-1.5">
                      <input type="number" min={1} max={12} step={1} value={shot.duration_s} onChange={(e) => updateShot(shot.id, { duration_s: Math.min(12, Math.max(1, Number(e.target.value) || 1)) })} className="w-14 rounded border border-gray-700 bg-gray-950 px-2 py-1 text-center text-xs text-white outline-none focus:ring-1 focus:ring-indigo-500/40" />
                      <span className="text-xs text-gray-500">sec</span>
                      {cc > 0 && !over ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : over ? <AlertCircle className="h-3.5 w-3.5 text-red-400" /> : null}
                      {shots.length > 1 && <button type="button" onClick={() => deleteShot(shot.id)} className="ml-1 text-gray-500 hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>}
                    </div>
                  </div>
                  <textarea value={shot.prompt} onChange={(e) => updateShot(shot.id, { prompt: e.target.value })} rows={2} placeholder="Décris ce qui se passe dans ce shot…" className={cn("block w-full rounded border bg-gray-950 px-2.5 py-2 text-sm text-white placeholder-gray-600 outline-none transition", over ? "border-red-600 focus:ring-red-500/40" : "border-gray-700 focus:ring-1 focus:ring-indigo-500/40")} />
                  <div className="mt-1 text-right"><span className={cn("text-xs", over ? "text-red-400" : cc > 400 ? "text-yellow-400" : "text-gray-500")}>{cc}/{MAX_PROMPT}</span></div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ============= STEP 4 — Choisir le modèle ============= */}
      {step === 4 && (
        <div className="space-y-6">
          <p className="text-sm text-gray-400">Sélectionne le provider pour le rendu de ce projet.</p>
          {connections.length === 0 && (
            <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center">
              <WifiOff className="mx-auto h-8 w-8 text-gray-600" />
              <p className="mt-3 text-sm text-gray-400">Aucune clé API connectée.</p>
              <button type="button" onClick={() => router.push("/connections")} className="mt-3 text-sm font-medium text-indigo-400 hover:text-indigo-300">Configurer mes connexions</button>
            </div>
          )}
          <div className="space-y-2">
            {connections.map((conn) => {
              const isConnected = conn.status === "connected";
              const isSelected = selectedProvider === conn.provider;
              return (
                <button
                  key={conn.id}
                  type="button"
                  onClick={() => isConnected && setSelectedProvider(conn.provider)}
                  disabled={!isConnected}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg border p-4 text-left transition",
                    isSelected ? "border-indigo-500 bg-indigo-950/30" : "border-gray-700 bg-gray-900",
                    !isConnected && "cursor-not-allowed opacity-50"
                  )}
                >
                  <div className="flex items-center gap-3">
                    {isConnected ? <Wifi className="h-5 w-5 text-emerald-400" /> : <WifiOff className="h-5 w-5 text-gray-500" />}
                    <div>
                      <p className="text-sm font-medium capitalize text-white">{conn.provider === "kieai" ? "Kie.ai (Kling v3)" : conn.provider}</p>
                      <p className="text-xs text-gray-500">
                        {isConnected ? `Connecté — ••••${conn.key_last_four}` : conn.status === "key_invalid" ? "Clé invalide" : "Déconnecté"}
                        {conn.balance_cached != null && ` — ${conn.balance_cached} crédits`}
                      </p>
                    </div>
                  </div>
                  {isSelected && <Check className="h-5 w-5 text-indigo-400" />}
                </button>
              );
            })}
          </div>
          {connections.length > 0 && (
            <p className="text-xs text-gray-500">
              Mode : <span className="text-white">{mode === "pro" ? "Pro" : "Standard"}</span> — Format : <span className="text-white">{aspectRatio}</span> — Durée : <span className="text-white">{totalDuration}s</span>
            </p>
          )}
        </div>
      )}

      {/* ============= STEP 5 — Validation & Coût ============= */}
      {step === 5 && (
        <div className="space-y-6">
          {/* Cost */}
          <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center">
            <CircleDollarSign className="mx-auto h-8 w-8 text-indigo-400" />
            <p className="mt-3 text-3xl font-bold text-white">~{estimatedCost} <span className="text-lg font-normal text-gray-400">crédits</span></p>
            <p className="mt-1 text-xs text-gray-500">Estimation basée sur {totalDuration}s en mode {mode === "pro" ? "Pro" : "Standard"}</p>
            <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-gray-700 px-3 py-1 text-sm">
              {balanceLoading ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" /><span className="text-gray-400">Vérification du solde…</span></>
              ) : balance !== null ? (
                <><span className={balance >= estimatedCost ? "text-emerald-400" : "text-red-400"}>{balance} crédits disponibles</span></>
              ) : (
                <span className="text-red-400">Solde indisponible</span>
              )}
            </div>
          </div>

          {/* Checklist */}
          <div className="space-y-1">
            <p className="mb-2 text-sm font-medium text-gray-300">Validation du projet</p>
            {checks.map((c, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  {c.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-red-400" />}
                  <span className={cn("text-sm", c.ok ? "text-gray-300" : "text-red-300")}>{c.label}</span>
                </div>
                {!c.ok && (
                  <button type="button" onClick={() => { saveProject(); setStep(c.fixStep); }} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-indigo-400 hover:bg-indigo-950/40 hover:text-indigo-300">
                    <Pencil className="h-3 w-3" /> Corriger
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Generate button */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!allValid || submitting}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-medium transition",
              allValid ? "bg-indigo-600 text-white hover:bg-indigo-500" : "cursor-not-allowed bg-gray-800 text-gray-500"
            )}
          >
            {submitting ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Soumission en cours…</>
            ) : (
              <><Zap className="h-4 w-4" /> Générer la vidéo</>
            )}
          </button>
          {!allValid && <p className="text-center text-xs text-gray-500">Corrige tous les points ci-dessus pour activer la génération.</p>}
        </div>
      )}

      {/* ============= STEP 6 — Suivi du rendu ============= */}
      {step === 6 && renderJob && renderStatus && (
        <div className="space-y-6">
          {/* Progress bar */}
          <div className="rounded-lg border border-gray-700 bg-gray-900 p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {renderJob.status === "succeeded" ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                ) : renderJob.status === "failed" ? (
                  <XCircle className="h-5 w-5 text-red-400" />
                ) : (
                  <Loader2 className="h-5 w-5 animate-spin text-indigo-400" />
                )}
                <span className={cn("text-lg font-medium", renderJob.status === "succeeded" ? "text-emerald-300" : renderJob.status === "failed" ? "text-red-300" : "text-white")}>
                  {renderStatus.label}
                </span>
              </div>
              {renderJob.provider_task_id && (
                <span className="text-xs text-gray-500">Task ID : {renderJob.provider_task_id}</span>
              )}
            </div>

            {/* Bar */}
            <div className="h-2 overflow-hidden rounded-full bg-gray-800">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-700",
                  renderJob.status === "succeeded" ? "bg-emerald-500" : renderJob.status === "failed" ? "bg-red-500" : "bg-indigo-500"
                )}
                style={{ width: `${renderStatus.pct}%` }}
              />
            </div>

            {/* Detail below bar */}
            <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Lancé {new Date(renderJob.created_at).toLocaleString("fr-FR")}
              </div>
              {renderJob.status !== "succeeded" && renderJob.status !== "failed" && (
                <span>Durée estimée : ~{totalDuration * 3}s</span>
              )}
            </div>
          </div>

          {/* Error message */}
          {renderJob.status === "failed" && renderJob.error_message && (
            <div className="flex items-start gap-2 rounded-lg border border-red-800 bg-red-950/40 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <div>
                <p className="text-sm text-red-300">{renderJob.error_message}</p>
                {renderJob.error_code && <p className="mt-1 text-xs text-red-400/70">Code : {renderJob.error_code}</p>}
              </div>
            </div>
          )}

          {/* Success */}
          {renderJob.status === "succeeded" && (
            <div className="rounded-lg border border-emerald-800 bg-emerald-950/40 p-4 text-center">
              <Play className="mx-auto h-8 w-8 text-emerald-400" />
              <p className="mt-2 text-sm font-medium text-emerald-300">Ta vidéo est prête !</p>
              <p className="mt-1 text-xs text-gray-400">Consulte le résultat dans la page du projet.</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-center gap-3">
            <button type="button" onClick={() => router.push("/projects")} className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:border-gray-500 hover:text-white">
              Retour aux projets
            </button>
          </div>
        </div>
      )}

      {/* ============= Navigation ============= */}
      {step < 6 && (
        <div className="mt-8 flex items-center justify-between">
          <button type="button" onClick={step === 1 ? () => router.push("/projects") : handleBack} className="flex items-center gap-1 rounded-lg border border-gray-700 px-4 py-2.5 text-sm text-gray-300 transition hover:border-gray-500 hover:text-white">
            <ChevronLeft className="h-4 w-4" />
            {step === 1 ? "Annuler" : "Précédent"}
          </button>

          {step < 5 ? (
            <button type="button" onClick={handleNext} disabled={saving || (step === 1 && !name.trim()) || (step === 4 && !selectedProvider)} className={cn("flex items-center gap-1 rounded-lg px-5 py-2.5 text-sm font-medium transition", "bg-indigo-600 text-white hover:bg-indigo-500", "disabled:cursor-not-allowed disabled:opacity-50")}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Suivant <ChevronRight className="h-4 w-4" /></>}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

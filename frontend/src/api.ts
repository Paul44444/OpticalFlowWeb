import type { ArchiveItem, ComputeSettings, JobResult } from "./types";

const FALLBACK_API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
let apiBasePromise: Promise<string> | undefined;

function normalizeApiBase(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Invalid backend protocol");
  return url.toString().replace(/\/$/, "");
}

async function getApiBase(): Promise<string> {
  if (!apiBasePromise) {
    apiBasePromise = fetch(`${import.meta.env.BASE_URL}backend.json?t=${Date.now()}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Backend configuration unavailable");
        const config: { url?: unknown } = await response.json();
        if (typeof config.url !== "string") throw new Error("Invalid backend configuration");
        return normalizeApiBase(config.url);
      })
      .catch(() => normalizeApiBase(FALLBACK_API_BASE));
  }
  return apiBasePromise;
}

export async function getHealth(): Promise<{ status: string; device: "cuda" | "cpu"; gpu_name: string }> {
  const apiBase = await getApiBase();
  const response = await fetch(`${apiBase}/api/health`);
  if (!response.ok) throw new Error("Backend unavailable");
  return response.json();
}

function resolveResultUrls(job: JobResult, apiBase: string): JobResult {
  if (!job.results || !apiBase) return job;
  return {
    ...job,
    results: Object.fromEntries(
      Object.entries(job.results).map(([name, url]) => [name, new URL(url, apiBase).toString()]),
    ),
  };
}

export async function createJob(files: File[], settings: ComputeSettings): Promise<JobResult> {
  const apiBase = await getApiBase();
  const body = new FormData();
  body.append("image1", files[0]);
  body.append("image2", files[1]);
  body.append("settings", JSON.stringify(settings));
  const response = await fetch(`${apiBase}/api/jobs`, { method: "POST", body });
  if (!response.ok) throw new Error(await response.text() || "Could not create job");
  return resolveResultUrls(await response.json(), apiBase);
}

export async function getJob(id: string): Promise<JobResult> {
  const apiBase = await getApiBase();
  const response = await fetch(`${apiBase}/api/jobs/${id}`);
  if (!response.ok) throw new Error(await response.text() || "Could not read job");
  return resolveResultUrls(await response.json(), apiBase);
}

export async function getArchive(): Promise<ArchiveItem[]> {
  const apiBase = await getApiBase();
  const response = await fetch(`${apiBase}/api/archive`);
  if (!response.ok) throw new Error("Could not load archive");
  const data: { items: ArchiveItem[] } = await response.json();
  return data.items;
}

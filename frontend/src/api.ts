import type { ComputeSettings, JobResult } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export async function getHealth(): Promise<{ status: string; device: "cuda" | "cpu"; gpu_name: string }> {
  const response = await fetch(`${API_BASE}/api/health`);
  if (!response.ok) throw new Error("Backend unavailable");
  return response.json();
}

function resolveResultUrls(job: JobResult): JobResult {
  if (!job.results || !API_BASE) return job;
  return {
    ...job,
    results: Object.fromEntries(
      Object.entries(job.results).map(([name, url]) => [name, new URL(url, API_BASE).toString()]),
    ),
  };
}

export async function createJob(files: File[], settings: ComputeSettings): Promise<JobResult> {
  const body = new FormData();
  body.append("image1", files[0]);
  body.append("image2", files[1]);
  body.append("settings", JSON.stringify(settings));
  const response = await fetch(`${API_BASE}/api/jobs`, { method: "POST", body });
  if (!response.ok) throw new Error(await response.text() || "Could not create job");
  return resolveResultUrls(await response.json());
}

export async function getJob(id: string): Promise<JobResult> {
  const response = await fetch(`${API_BASE}/api/jobs/${id}`);
  if (!response.ok) throw new Error(await response.text() || "Could not read job");
  return resolveResultUrls(await response.json());
}

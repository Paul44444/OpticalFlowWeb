import type { ComputeSettings, JobResult } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export async function createJob(files: File[], settings: ComputeSettings): Promise<JobResult> {
  const body = new FormData();
  body.append("image1", files[0]);
  body.append("image2", files[1]);
  body.append("settings", JSON.stringify(settings));
  const response = await fetch(`${API_BASE}/api/jobs`, { method: "POST", body });
  if (!response.ok) throw new Error(await response.text() || "Could not create job");
  return response.json();
}

export async function getJob(id: string): Promise<JobResult> {
  const response = await fetch(`${API_BASE}/api/jobs/${id}`);
  if (!response.ok) throw new Error(await response.text() || "Could not read job");
  return response.json();
}


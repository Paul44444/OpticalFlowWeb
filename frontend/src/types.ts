export type Solver = "tv" | "tgv" | "both";
export type Quality = "quick" | "precise" | "custom";
export type JobStatus = "idle" | "uploading" | "queued" | "running" | "complete" | "failed";

export interface InputImage {
  id: string;
  file: File;
  previewUrl: string;
  role: "reference" | "deformed";
}

export interface ComputeSettings {
  solver: Solver;
  quality: Quality;
  size: number;
  levels: number;
  warps: number;
  iterations: number;
  alpha1: number;
  alpha2: number;
  phaseInit: boolean;
  cropMode: "full" | "plot" | "specimen";
}

export interface JobMetrics {
  mae_before: number;
  mae_after: number;
  rmse_before: number;
  rmse_after: number;
  mse_improvement_fraction: number;
}

export interface JobResult {
  id: string;
  status: JobStatus;
  progress: number;
  stage: string;
  error?: string;
  results?: Record<string, string>;
  metrics?: Record<string, JobMetrics | Record<string, unknown>>;
}


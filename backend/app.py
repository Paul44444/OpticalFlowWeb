"""Local job API for Hewer Flow Studio."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

HERE = Path(__file__).resolve().parent
HEWER_ROOT = HERE.parents[1]
JOBS_ROOT = HERE / "jobs"
JOBS_ROOT.mkdir(exist_ok=True)

app = FastAPI(title="Hewer Flow API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("HEWER_ALLOWED_ORIGINS", "http://localhost:5173").split(","),
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.mount("/results", StaticFiles(directory=JOBS_ROOT), name="results")

jobs: dict[str, dict[str, Any]] = {}
jobs_lock = threading.Lock()
compute_lock = threading.Lock()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def save_job(job: dict[str, Any]) -> None:
    path = JOBS_ROOT / job["id"] / "job.json"
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(job, indent=2), encoding="utf-8")
    temporary.replace(path)


def load_saved_jobs() -> None:
    for job_root in JOBS_ROOT.iterdir():
        if not job_root.is_dir() or len(job_root.name) != 32:
            continue
        manifest = job_root / "job.json"
        if manifest.exists():
            try:
                job = json.loads(manifest.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                continue
            if job.get("status") in {"queued", "running", "uploading"}:
                job.update(status="failed", progress=0, stage="Interrupted by backend restart",
                           error="The backend restarted during computation")
                save_job(job)
        else:
            output = job_root / "output"
            metrics_file = output / "metrics.json"
            if not metrics_file.exists():
                continue
            try:
                metrics = json.loads(metrics_file.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                continue
            created_at = datetime.fromtimestamp(job_root.stat().st_mtime, timezone.utc).isoformat()
            job = {"id": job_root.name, "status": "complete", "progress": 100,
                   "stage": "Imported previous computation", "created_at": created_at,
                   "completed_at": created_at, "image1_name": "Reference frame",
                   "image2_name": "Deformed frame", "settings": {"solver": "both"},
                   "metrics": metrics, "results": result_urls(job_root.name, output)}
            save_job(job)
        jobs[job_root.name] = job


def update_job(job_id: str, **values: Any) -> None:
    with jobs_lock:
        jobs[job_id].update(values)
        save_job(jobs[job_id])


def result_urls(job_id: str, output: Path) -> dict[str, str]:
    names = [
        "input_1.png", "input_2.png", "tv_tgv_comparison.png", "strain_comparison.png",
        "flow_color_tv.png", "flow_color_tgv.png", "magnitude_tv.png", "magnitude_tgv.png",
        "flow_components_tv.png", "flow_components_tgv.png", "warped_tv.png", "warped_tgv.png",
        "residual_tv.png", "residual_tgv.png"
    ]
    urls = {Path(name).stem: f"/results/{job_id}/output/{name}" for name in names if (output / name).exists()}
    urls["download"] = f"/results/{job_id}/results.zip"
    return urls


def run_job(job_id: str, image1: Path, image2: Path, settings: dict[str, Any]) -> None:
    output = JOBS_ROOT / job_id / "output"
    output.mkdir(parents=True, exist_ok=True)
    update_job(job_id, status="queued", progress=10, stage="Waiting for local compute")
    try:
        with compute_lock:
            import torch

            compute_device = "cuda" if torch.cuda.is_available() else "cpu"
            update_job(job_id, status="running", progress=20,
                       stage=f"Computing TV / TGV fields on {compute_device.upper()}", device=compute_device)
            command = [
                sys.executable, str(HEWER_ROOT / "compare_tv_tgv.py"),
                "--image1", str(image1), "--image2", str(image2),
                "--output", str(output), "--crop-mode", settings.get("cropMode", "full"),
                "--size", str(int(settings.get("size", 192))),
                "--levels", str(int(settings.get("levels", 3))),
                "--warps", str(int(settings.get("warps", 4))),
                "--iterations", str(int(settings.get("iterations", 500))),
                "--alpha1", str(float(settings.get("alpha1", 0.003))),
                "--tgv-alpha2", str(float(settings.get("alpha2", 0.006))),
                "--device", compute_device,
            ]
            if not settings.get("phaseInit", True):
                command.append("--no-phase-init")
            environment = {**os.environ, "MPLCONFIGDIR": str(JOBS_ROOT / ".matplotlib")}
            completed = subprocess.run(command, cwd=HEWER_ROOT, env=environment, capture_output=True, text=True)
            if completed.returncode:
                raise RuntimeError(completed.stderr[-3000:] or completed.stdout[-3000:])

            update_job(job_id, progress=88, stage="Packaging result fields")
            archive = JOBS_ROOT / job_id / "results.zip"
            with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
                for path in output.iterdir():
                    bundle.write(path, path.name)
            metrics = json.loads((output / "metrics.json").read_text())
            update_job(
                job_id, status="complete", progress=100, stage="Computation complete",
                completed_at=utc_now(), results=result_urls(job_id, output), metrics=metrics,
            )
    except Exception as error:
        update_job(job_id, status="failed", progress=0, stage="Computation failed", error=str(error))


@app.get("/api/health")
def health() -> dict[str, str]:
    import torch

    available = torch.cuda.is_available()
    return {"status": "ok", "device": "cuda" if available else "cpu",
            "gpu_name": torch.cuda.get_device_name(0) if available else ""}


@app.post("/api/jobs", status_code=202)
async def create_job(
    background_tasks: BackgroundTasks,
    image1: UploadFile = File(...),
    image2: UploadFile = File(...),
    settings: str = Form(...),
) -> dict[str, Any]:
    try:
        parsed_settings = json.loads(settings)
    except json.JSONDecodeError as error:
        raise HTTPException(400, "Invalid settings JSON") from error
    job_id = uuid.uuid4().hex
    job_root = JOBS_ROOT / job_id
    job_root.mkdir()
    paths = []
    for index, upload in enumerate((image1, image2), start=1):
        suffix = Path(upload.filename or ".png").suffix.lower()
        if suffix not in {".png", ".jpg", ".jpeg", ".tif", ".tiff"}:
            raise HTTPException(415, f"Unsupported image type: {suffix}")
        path = job_root / f"input{index}{suffix}"
        with path.open("wb") as target:
            shutil.copyfileobj(upload.file, target)
        paths.append(path)
    job = {"id": job_id, "status": "queued", "progress": 8, "stage": "Job accepted",
           "created_at": utc_now(), "image1_name": image1.filename or "Reference frame",
           "image2_name": image2.filename or "Deformed frame", "settings": parsed_settings}
    with jobs_lock:
        jobs[job_id] = job
        save_job(job)
    background_tasks.add_task(run_job, job_id, paths[0], paths[1], parsed_settings)
    return job


@app.get("/api/archive")
def list_archive(limit: int = 50) -> dict[str, Any]:
    if not 1 <= limit <= 100:
        raise HTTPException(400, "limit must be between 1 and 100")
    with jobs_lock:
        completed = sorted(
            (job for job in jobs.values() if job.get("status") == "complete"),
            key=lambda job: job.get("created_at", ""), reverse=True,
        )[:limit]
        items = [{"id": job["id"], "created_at": job.get("created_at"),
                  "completed_at": job.get("completed_at"),
                  "image1_name": job.get("image1_name"), "image2_name": job.get("image2_name"),
                  "solver": job.get("settings", {}).get("solver", "both"),
                  "device": job.get("device", "unknown")}
                 for job in completed]
    return {"items": items}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    with jobs_lock:
        job = jobs.get(job_id)
        if job is None:
            raise HTTPException(404, "Unknown job")
        return dict(job)


load_saved_jobs()

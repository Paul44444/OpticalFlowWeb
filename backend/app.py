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


def update_job(job_id: str, **values: Any) -> None:
    with jobs_lock:
        jobs[job_id].update(values)


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
                results=result_urls(job_id, output), metrics=metrics,
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
    job = {"id": job_id, "status": "queued", "progress": 8, "stage": "Job accepted"}
    with jobs_lock:
        jobs[job_id] = job
    background_tasks.add_task(run_job, job_id, paths[0], paths[1], parsed_settings)
    return job


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    with jobs_lock:
        job = jobs.get(job_id)
        if job is None:
            raise HTTPException(404, "Unknown job")
        return dict(job)

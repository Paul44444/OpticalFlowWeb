# Hewer Flow Studio

React/Vite workbench with a local FastAPI compute backend for TV/TGV optical flow and strain maps.

## Local development

Backend, from the repository root:

```bash
.venv/bin/pip install -r hewer-web/backend/requirements.txt
.venv/bin/uvicorn app:app --app-dir hewer-web/backend --host 127.0.0.1 --port 8000 --reload
```

Frontend, in another terminal:

```bash
cd hewer-web/frontend
npm install
npm run dev
```

Open `http://localhost:5173` and drop two images into the workbench.

The backend uses CUDA for TV/TGV jobs when PyTorch detects an NVIDIA GPU;
otherwise it runs on CPU. `/api/health` reports the selected device and GPU
name. The compute CLI also accepts `--device auto|cuda|cpu` for direct runs.

The built-in sample pair is derived from `regul/I1l.png` and `regul/I2l.png`.
Both images use the identical pixel crop `x=144:513, y=59:427`; only the
Matplotlib figure margins and axis annotations are removed. The original
repository images are unchanged.

## Saved analyses

Completed jobs remain under `hewer-web/backend/jobs/<job-id>/`. Each new job
has a `job.json` manifest with UTC creation/completion timestamps, input names,
settings, status, and result links. `GET /api/archive` returns metadata for the
50 newest completed jobs; the frontend loads result images only after a job is
selected. Existing result directories without a manifest are imported on
backend startup, using the directory timestamp and generic input names.

The current Quick Tunnel and archive API are public. Do not upload confidential
images until authentication and access controls are added.

## Deployment shape

The Vite frontend can be deployed to Vercel. For a public deployment, set
`VITE_API_BASE_URL` to an authenticated public API or replace the local API
implementation with the planned Blob/Postgres queue. Do not expose the local
FastAPI process directly without authentication and TLS.

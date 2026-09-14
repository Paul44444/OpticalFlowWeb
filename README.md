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

## Deployment shape

The Vite frontend can be deployed to Vercel. For a public deployment, set
`VITE_API_BASE_URL` to an authenticated public API or replace the local API
implementation with the planned Blob/Postgres queue. Do not expose the local
FastAPI process directly without authentication and TLS.

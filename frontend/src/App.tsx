import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, Archive, ArrowRight, Check, ChevronDown, Download, Gauge, ImagePlus,
  LoaderCircle, Maximize2, Play, RefreshCw, Settings2, X
} from "lucide-react";
import { createJob, getArchive, getHealth, getJob } from "./api";
import type { ArchiveItem, ComputeSettings, InputImage, JobResult, Quality, Solver } from "./types";

const defaultSettings: ComputeSettings = {
  solver: "both", quality: "quick", size: 192, levels: 3, warps: 4,
  iterations: 500, alpha1: 0.003, alpha2: 0.006, phaseInit: true, cropMode: "full"
};

const qualitySettings: Record<Exclude<Quality, "custom">, Partial<ComputeSettings>> = {
  quick: { size: 192, levels: 3, warps: 4, iterations: 500 },
  precise: { size: 384, levels: 4, warps: 5, iterations: 800 }
};

const samples = {
  reference: { name: "I1l.png", url: `${import.meta.env.BASE_URL}samples/reference.png` },
  deformed: { name: "I2l.png", url: `${import.meta.env.BASE_URL}samples/deformed.png` }
} as const;

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function DropCard({ image, role, onFile, onSample, onRemove }: {
  image?: InputImage; role: InputImage["role"]; onFile: (file: File) => void;
  onSample: (role: InputImage["role"]) => void; onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const title = role === "reference" ? "Reference frame" : "Deformed frame";
  return (
    <div
      className={`drop-card ${dragging ? "is-dragging" : ""} ${image ? "has-image" : ""}`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault(); setDragging(false);
        const sampleRole = event.dataTransfer.getData("application/x-hewer-sample");
        if (sampleRole === "reference" || sampleRole === "deformed") {
          onSample(sampleRole); return;
        }
        const file = event.dataTransfer.files[0]; if (file?.type.startsWith("image/")) onFile(file);
      }}
    >
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/tiff" hidden
        onChange={(event) => event.target.files?.[0] && onFile(event.target.files[0])} />
      {image ? (
        <>
          <img src={image.previewUrl} alt={title} />
          <div className="image-shade" />
          <button className="icon-button remove" onClick={onRemove} aria-label="Remove image"><X size={17} /></button>
          <div className="image-meta">
            <span className="eyebrow">{title}</span>
            <strong>{image.file.name}</strong>
            <span>{formatBytes(image.file.size)}</span>
          </div>
        </>
      ) : (
        <button className="drop-empty" onClick={() => inputRef.current?.click()}>
          <span className="drop-icon"><ImagePlus size={27} /></span>
          <strong>{title}</strong>
          <span>Drop an image here or browse</span>
          <small>PNG, JPG or TIFF</small>
        </button>
      )}
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string }[]; onChange: (value: T) => void;
}) {
  return <div className="segmented">{options.map((option) =>
    <button key={option.value} className={value === option.value ? "active" : ""}
      onClick={() => onChange(option.value)}>{option.label}</button>)}</div>;
}

function ParameterSlider({ label, detail, value, min, max, step, onChange }: {
  label: string; detail: string; value: number; min: number; max: number; step: number;
  onChange: (value: number) => void;
}) {
  return <label className="parameter-slider">
    <span className="slider-heading"><span>{label}<small>{detail}</small></span><output>{value.toFixed(step < 1 ? 4 : 0)}</output></span>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={(event) => onChange(Number(event.target.value))} />
    <span className="slider-scale"><span>{min}</span><span>{max}</span></span>
  </label>;
}

const resultTabs = ["Overview", "Flow", "Strain", "Diagnostics"] as const;
type ResultTab = typeof resultTabs[number];

function ResultImage({ src, title, kicker }: { src?: string; title: string; kicker?: string }) {
  return <article className="result-card">
    <header><div><span>{kicker ?? "OUTPUT"}</span><h3>{title}</h3></div>
      {src && <a className="icon-button" href={src} target="_blank" rel="noreferrer"><Maximize2 size={16} /></a>}</header>
    <div className="result-visual">{src ? <img src={src} alt={title} /> : <div className="result-placeholder"><Activity size={30} /><span>Awaiting computation</span></div>}</div>
  </article>;
}

function App() {
  const [images, setImages] = useState<Partial<Record<InputImage["role"], InputImage>>>({});
  const [settings, setSettings] = useState(defaultSettings);
  const [advanced, setAdvanced] = useState(false);
  const [job, setJob] = useState<JobResult>({ id: "", status: "idle", progress: 0, stage: "Ready" });
  const [tab, setTab] = useState<ResultTab>("Overview");
  const [backend, setBackend] = useState<{ device: "cuda" | "cpu"; gpu_name: string } | null>(null);
  const [archive, setArchive] = useState<ArchiveItem[]>([]);
  const [archiveError, setArchiveError] = useState("");

  useEffect(() => {
    getHealth().then(({ device, gpu_name }) => setBackend({ device, gpu_name })).catch(() => setBackend(null));
    getArchive().then(setArchive).catch(() => setArchiveError("Archive unavailable"));
  }, []);

  useEffect(() => {
    if (job.status === "complete") getArchive().then(setArchive).catch(() => setArchiveError("Archive unavailable"));
  }, [job.status]);

  const filesReady = Boolean(images.reference && images.deformed);
  const busy = ["uploading", "queued", "running"].includes(job.status);

  useEffect(() => {
    if (!job.id || !["queued", "running", "uploading"].includes(job.status)) return;
    const timer = window.setInterval(async () => {
      try { setJob(await getJob(job.id)); } catch (error) { console.error(error); }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [job.id, job.status]);

  useEffect(() => () => Object.values(images).forEach((image) => image && URL.revokeObjectURL(image.previewUrl)), []);

  const setImage = (role: InputImage["role"], file: File) => {
    setImages((current) => {
      if (current[role]) URL.revokeObjectURL(current[role]!.previewUrl);
      return { ...current, [role]: { id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file), role } };
    });
  };

  const loadSample = async (sampleRole: InputImage["role"], targetRole = sampleRole) => {
    try {
      const sample = samples[sampleRole];
      const response = await fetch(sample.url);
      if (!response.ok) throw new Error(`Sample image unavailable: ${sample.name}`);
      setImage(targetRole, new File([await response.blob()], sample.name, { type: "image/png" }));
    } catch (error) {
      setJob({ id: "", status: "failed", progress: 0, stage: "Sample loading failed", error: String(error) });
    }
  };

  const setQuality = (quality: Quality) => {
    setSettings((current) => ({ ...current, quality, ...(quality === "custom" ? {} : qualitySettings[quality]) }));
  };

  const compute = async () => {
    if (!images.reference || !images.deformed) return;
    setJob({ id: "", status: "uploading", progress: 4, stage: "Uploading image pair" });
    try { setJob(await createJob([images.reference.file, images.deformed.file], settings)); }
    catch (error) { setJob({ id: "", status: "failed", progress: 0, stage: "Request failed", error: String(error) }); }
  };

  const openArchiveJob = async (id: string) => {
    try {
      const saved = await getJob(id);
      setSettings({ ...defaultSettings, ...saved.settings });
      setJob(saved);
      setTab("Overview");
      window.setTimeout(() => document.getElementById("results")?.scrollIntoView({ behavior: "smooth" }), 0);
    } catch {
      setArchiveError("Could not open archived result");
    }
  };

  const results = job.results ?? {};
  const preferred = settings.solver === "tv" ? "tv" : "tgv";
  const metric = job.metrics?.[preferred] as Record<string, number> | undefined;
  const improvement = metric ? `${(metric.mse_improvement_fraction * 100).toFixed(1)}%` : "—";
  const cards = useMemo(() => {
    if (tab === "Overview") return [
      [results.input_1, "Reference frame", "INPUT"], [results.input_2, "Deformed frame", "INPUT"],
      [results[`warped_${preferred}`], `Warped by ${preferred.toUpperCase()}`, "RECONSTRUCTION"],
      [results[`residual_${preferred}`], `Residual · ${improvement} better`, "VALIDATION"]
    ];
    if (tab === "Flow") return [
      [results[`flow_color_${preferred}`], "Direction + magnitude", preferred.toUpperCase()],
      [results[`magnitude_${preferred}`], "Flow magnitude", preferred.toUpperCase()],
      [results[`flow_components_${preferred}`], "Displacement components", preferred.toUpperCase()],
      [results.tv_tgv_comparison, "TV / TGV comparison", "COMPARISON"]
    ];
    if (tab === "Strain") return [[results.strain_comparison, "Strain tensor components", "DERIVED FIELD"]];
    return [];
  }, [tab, results, preferred, improvement]);

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#"><span className="brand-mark">HF</span><span>HEWER <em>OPTICAL FLOW</em></span></a>
      <div className="system-status"><span className={`status-dot ${backend ? "" : "offline"}`} /> Compute backend <strong>{backend ? `${backend.device.toUpperCase()}${backend.gpu_name ? ` · ${backend.gpu_name}` : ""}` : "offline"}</strong></div>
    </header>

    <main>
      <section className="hero">
        <div><span className="section-index">ANALYSIS WORKSPACE</span><h1>Optical flow and strain estimation</h1>
          <p>Variational displacement-field reconstruction from experimental image pairs.</p></div>
        <div className="hero-stat"><Gauge size={20} /><span>NUMERICAL METHOD</span><strong>TV / TGV · PDHG</strong></div>
      </section>

      <section className="workspace-grid">
        <div className="input-panel panel">
          <div className="panel-heading"><div><span>INPUT DATA</span><h2>Image pair</h2></div><span className="counter">{Object.keys(images).length}/2</span></div>
          <div className="drop-grid">
            <DropCard role="reference" image={images.reference} onFile={(f) => setImage("reference", f)} onSample={(role) => void loadSample(role, "reference")} onRemove={() => setImages((v) => ({ ...v, reference: undefined }))} />
            <div className="flow-arrow"><ArrowRight size={20} /></div>
            <DropCard role="deformed" image={images.deformed} onFile={(f) => setImage("deformed", f)} onSample={(role) => void loadSample(role, "deformed")} onRemove={() => setImages((v) => ({ ...v, deformed: undefined }))} />
          </div>
          <div className="sample-dataset">
            <div className="sample-heading"><div><span>SAMPLE DATASET</span><p>Cropped measurement ROI. Click to load or drag into the inputs.</p></div>
              <button onClick={() => { void loadSample("reference"); void loadSample("deformed"); }}>Load image pair</button></div>
            <div className="sample-list">{(["reference", "deformed"] as const).map((role) =>
              <button key={role} className="sample-item" draggable
                onDragStart={(event) => event.dataTransfer.setData("application/x-hewer-sample", role)}
                onClick={() => void loadSample(role)} title={`Load ${samples[role].name} into ${role} input`}>
                <img src={samples[role].url} alt={`${role} sample frame`} draggable={false} />
                <span><strong>{samples[role].name}</strong><small>{role === "reference" ? "Reference / I1" : "Deformed / I2"}</small></span>
              </button>)}</div>
          </div>
        </div>

        <aside className="controls panel">
          <div className="panel-heading"><div><span>CONFIGURATION</span><h2>Solver parameters</h2></div><Settings2 size={19} /></div>
          <label>Solver</label>
          <Segmented<Solver> value={settings.solver} options={[{value:"tv",label:"TV"},{value:"tgv",label:"TGV"},{value:"both",label:"Both"}]}
            onChange={(solver) => setSettings((v) => ({ ...v, solver }))} />
          <label>Quality</label>
          <Segmented<Quality> value={settings.quality} options={[{value:"quick",label:"Quick"},{value:"precise",label:"Precise"},{value:"custom",label:"Custom"}]}
            onChange={setQuality} />
          <div className="slider-group">
            <span className="slider-group-title">REGULARIZATION / CONVERGENCE</span>
            <ParameterSlider label="TV weight · α₁" detail="TV + TGV first order" value={settings.alpha1} min={0.0005} max={0.02} step={0.0005}
              onChange={(alpha1) => setSettings((v) => ({ ...v, quality: "custom", alpha1 }))} />
            {(settings.solver === "tgv" || settings.solver === "both") && <ParameterSlider label="TGV weight · α₂" detail="TGV second order" value={settings.alpha2} min={0.001} max={0.03} step={0.001}
              onChange={(alpha2) => setSettings((v) => ({ ...v, quality: "custom", alpha2 }))} />}
            <ParameterSlider label="PDHG iterations" detail="Per warp / pyramid level" value={settings.iterations} min={100} max={1000} step={50}
              onChange={(iterations) => setSettings((v) => ({ ...v, quality: "custom", iterations }))} />
          </div>
          <button className="advanced-toggle" onClick={() => setAdvanced((v) => !v)}><span>Advanced parameters</span><ChevronDown size={16} className={advanced ? "rotated" : ""} /></button>
          {advanced && <div className="advanced-grid">
            {(["size","levels","warps"] as const).map((key) => <label key={key}><span>{key}</span><input type="number" step="1" value={settings[key]}
              onChange={(e) => setSettings((v) => ({ ...v, quality: "custom", [key]: Number(e.target.value) }))} /></label>)}
            <label className="check-row"><input type="checkbox" checked={settings.phaseInit} onChange={(e) => setSettings((v) => ({...v, phaseInit:e.target.checked}))} /><span>Phase initialization</span></label>
          </div>}
          <button className="compute-button" disabled={!filesReady || busy} onClick={compute}>
            {busy ? <LoaderCircle className="spin" size={19} /> : <Play size={18} fill="currentColor" />}
            <span>{busy ? job.stage : "Compute flow"}</span><kbd>↵</kbd>
          </button>
          {job.status !== "idle" && <div className={`job-progress ${job.status}`}>
            <div><span>{job.status === "complete" ? <Check size={14}/> : <RefreshCw size={14} className={busy ? "spin" : ""}/>} {job.stage}</span><strong>{job.progress}%</strong></div>
            <div className="progress-track"><i style={{ width: `${job.progress}%` }} /></div>
            {job.error && <p>{job.error}</p>}
          </div>}
        </aside>
      </section>

      <section className="archive-section panel">
        <div className="archive-heading"><div><span className="section-index">SAVED ANALYSES</span><h2>Archive</h2>
          <p>Results remain on the compute backend. Only metadata is loaded here.</p></div><Archive size={22} /></div>
        {archiveError && <p className="archive-error">{archiveError}</p>}
        {!archiveError && archive.length === 0 && <p className="archive-empty">No completed analyses yet.</p>}
        <div className="archive-list">{archive.map((item) => <button key={item.id}
          className={`archive-item ${job.id === item.id ? "active" : ""}`}
          onClick={() => void openArchiveJob(item.id)}>
          <span className="archive-date">{new Date(item.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
          <span className="archive-files"><strong>{item.image1_name}</strong><small>→</small><strong>{item.image2_name}</strong></span>
          <span className="archive-method">{item.solver.toUpperCase()} <small>· {item.device.toUpperCase()}</small></span>
          <ArrowRight size={16} /></button>)}</div>
      </section>

      <section className="results-section" id="results">
        <div className="results-heading"><div><span className="section-index">OUTPUT DATA</span><h2>Computed fields</h2></div>
          {job.status === "complete" && <a className="download-link" href={results.download}><Download size={16}/> Download data</a>}</div>
        <nav className="result-tabs">{resultTabs.map((item) => <button key={item} onClick={() => setTab(item)} className={tab === item ? "active" : ""}>{item}</button>)}</nav>
        {tab === "Diagnostics" ? <div className="diagnostics panel">
          <div><span>MSE improvement</span><strong>{improvement}</strong></div><div><span>RMSE after</span><strong>{metric ? metric.rmse_after.toFixed(5) : "—"}</strong></div>
          <div><span>Resolution</span><strong>{settings.size}²</strong></div><div><span>Solver</span><strong>{settings.solver.toUpperCase()}</strong></div>
        </div> : <div className={`results-grid ${tab === "Strain" ? "single" : ""}`}>
          {cards.map(([src,title,kicker]) => <ResultImage key={title} src={src} title={title} kicker={kicker} />)}
        </div>}
      </section>
    </main>
    <footer><span>HEWER · VARIATIONAL OPTICAL FLOW</span><span>LOCAL COMPUTE NODE · TV / TGV</span></footer>
  </div>;
}

export default App;

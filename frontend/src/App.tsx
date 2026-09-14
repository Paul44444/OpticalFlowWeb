import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowRight, Check, ChevronDown, Download, Gauge, ImagePlus,
  LoaderCircle, Maximize2, Play, RefreshCw, Settings2, X
} from "lucide-react";
import { createJob, getJob } from "./api";
import type { ComputeSettings, InputImage, JobResult, Quality, Solver } from "./types";

const defaultSettings: ComputeSettings = {
  solver: "both", quality: "quick", size: 192, levels: 3, warps: 4,
  iterations: 500, alpha1: 0.003, alpha2: 0.006, phaseInit: true, cropMode: "full"
};

const qualitySettings: Record<Exclude<Quality, "custom">, Partial<ComputeSettings>> = {
  quick: { size: 192, levels: 3, warps: 4, iterations: 500 },
  precise: { size: 384, levels: 4, warps: 5, iterations: 800 }
};

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function DropCard({ image, role, onFile, onRemove }: {
  image?: InputImage; role: InputImage["role"]; onFile: (file: File) => void; onRemove: () => void;
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

  const setQuality = (quality: Quality) => {
    setSettings((current) => ({ ...current, quality, ...(quality === "custom" ? {} : qualitySettings[quality]) }));
  };

  const compute = async () => {
    if (!images.reference || !images.deformed) return;
    setJob({ id: "", status: "uploading", progress: 4, stage: "Uploading image pair" });
    try { setJob(await createJob([images.reference.file, images.deformed.file], settings)); }
    catch (error) { setJob({ id: "", status: "failed", progress: 0, stage: "Request failed", error: String(error) }); }
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
      <div className="system-status"><span className="status-dot" /> Compute backend <strong>online</strong></div>
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
            <DropCard role="reference" image={images.reference} onFile={(f) => setImage("reference", f)} onRemove={() => setImages((v) => ({ ...v, reference: undefined }))} />
            <div className="flow-arrow"><ArrowRight size={20} /></div>
            <DropCard role="deformed" image={images.deformed} onFile={(f) => setImage("deformed", f)} onRemove={() => setImages((v) => ({ ...v, deformed: undefined }))} />
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
          <button className="advanced-toggle" onClick={() => setAdvanced((v) => !v)}><span>Advanced parameters</span><ChevronDown size={16} className={advanced ? "rotated" : ""} /></button>
          {advanced && <div className="advanced-grid">
            {(["size","levels","warps","iterations","alpha1","alpha2"] as const).map((key) => <label key={key}><span>{key}</span><input type="number" step={key.startsWith("alpha") ? "0.001" : "1"} value={settings[key]}
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

      <section className="results-section">
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

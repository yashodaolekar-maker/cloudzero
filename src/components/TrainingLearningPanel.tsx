import { useCallback, useEffect, useState } from "react";
import { BrainCircuit, Play, RefreshCw, ShieldCheck } from "lucide-react";

type Candidate = { id: string; domain: string; status: string; reason?: string; createdAt: string };
type Job = { id: string; domain: string; action: string; status: string; candidateCount: number; startedAt: string; completedAt?: string };
type Adapter = { id: string; domain: string; specialty?: string; status: string; createdAt: string; approvedBy?: string };
type State = { summary: { REVIEWED: number; CURATED_SIMULATION: number; QUARANTINED: number; REJECTED: number; activeJobId: string | null; adapterVersions: number }; candidates: Candidate[]; jobs: Job[]; adapters: Adapter[]; updatedAt: string };
const domains = ["NETWORK","WINDOWS","LINUX","DATABASE","CLOUDOPS","DEVOPS","MIDDLEWARE","SECURITY","SRE","COLLABORATION"];
const control = "rounded border border-slate-300 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-950";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init); const body = await response.json();
  if (!response.ok || body.success === false) throw new Error(body.error || "Training control request failed.");
  return body;
}

export default function TrainingLearningPanel() {
  const [state,setState]=useState<State|null>(null); const [domain,setDomain]=useState("NETWORK");
  const [scores,setScores]=useState({rootCauseAccuracy:"",evidenceTraceability:"",commandAccuracy:"",safeAbstention:""});
  const [busy,setBusy]=useState(""); const [message,setMessage]=useState(""); const [error,setError]=useState("");
  const load=useCallback(async()=>{ try { setState(await api<State>("/api/training/state")); setError(""); } catch(e){setError(e instanceof Error?e.message:"Training service unavailable.");}},[]);
  useEffect(()=>{void load(); const timer=window.setInterval(load,5000); return()=>window.clearInterval(timer);},[load]);
  async function post(path:string,payload:unknown,label:string){setBusy(label);setMessage("");setError("");try{await api(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});setMessage(`${label} accepted by the dedicated training container.`);await load();}catch(e){setError(e instanceof Error?e.message:`${label} failed.`);}finally{setBusy("");}}
  async function evaluate(adapter:Adapter){
    const metrics=Object.fromEntries(Object.entries(scores).map(([key,value])=>[key,Number(value)]));
    if(Object.keys(scores).some(key=>scores[key as keyof typeof scores].trim()==="")){setError("Enter all independently reviewed evaluation scores before recording the gate.");return;}
    await post("/api/training/evaluations",{adapterId:adapter.id,metrics},"Record evaluation");
  }
  return <details className="overflow-hidden rounded border border-indigo-200 bg-indigo-50/30 dark:border-indigo-900/50 dark:bg-indigo-950/10">
    <summary className="flex cursor-pointer list-none items-center gap-3 p-4"><BrainCircuit className="h-5 w-5 text-indigo-600"/><span className="flex-1"><strong className="block text-sm">Recursive QLoRA improvement control</strong><span className="text-xs text-slate-500">Reviewed evidence → domain dataset → adapter → evaluation → shadow</span></span><span className="font-mono text-xs">{state?.summary.REVIEWED??0} reviewed · {state?.summary.CURATED_SIMULATION??0} simulated</span></summary>
    <div className="space-y-4 border-t border-indigo-200 p-4 dark:border-indigo-900/50">
      {error&&<p role="alert" className="rounded bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">{error}</p>}{message&&<p role="status" className="rounded bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">{message}</p>}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">{[{l:"Human reviewed",v:state?.summary.REVIEWED??0},{l:"Curated simulation",v:state?.summary.CURATED_SIMULATION??0},{l:"Quarantined",v:state?.summary.QUARANTINED??0},{l:"Adapter versions",v:state?.summary.adapterVersions??0},{l:"Active job",v:state?.summary.activeJobId?"RUNNING":"NONE"}].map(x=><div key={x.l} className="rounded border border-slate-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"><p className="text-[10px] uppercase text-slate-500">{x.l}</p><p className="mt-1 font-mono text-lg font-bold">{x.v}</p></div>)}</div>
      <div className="flex flex-wrap items-end gap-2"><label className="grid gap-1 text-xs text-slate-500">Twin domain<select className={control} value={domain} onChange={e=>setDomain(e.target.value)}>{domains.map(x=><option key={x}>{x}</option>)}</select></label>
        <button disabled={!!busy} onClick={()=>post("/api/training/candidates/sync",{},"Candidate sync")} className={control}><RefreshCw className="mr-1 inline h-3.5 w-3.5"/>Sync reviewed work</button>
        <button disabled={!!busy} onClick={()=>post("/api/training/jobs",{domain,action:"PREFLIGHT"},"QLoRA preflight")} className={control}><ShieldCheck className="mr-1 inline h-3.5 w-3.5"/>Preflight</button>
        <button disabled={!!busy} onClick={()=>post("/api/training/jobs",{domain,action:"TRAIN"},"QLoRA training")} className="rounded bg-indigo-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><Play className="mr-1 inline h-3.5 w-3.5"/>Train version</button></div>
      <p className="text-xs leading-5 text-slate-500">Training requires at least 20 human-reviewed examples for the selected domain. Jobs never replace the serving model. A passing reviewed evaluation is required before shadow promotion.</p>
      <div className="grid gap-3 lg:grid-cols-2"><section><h4 className="mb-2 text-xs font-bold uppercase">Recent jobs</h4><div className="space-y-2">{state?.jobs.slice(-4).reverse().map(j=><div key={j.id} className="rounded border border-slate-200 p-3 text-xs dark:border-zinc-800"><strong>{j.domain} · {j.action}</strong><span className="float-right font-mono">{j.status}</span><p className="mt-1 text-slate-500">{j.candidateCount} reviewed candidates · {j.id}</p></div>)}{!state?.jobs.length&&<p className="text-xs text-slate-500">No training jobs recorded.</p>}</div></section>
      <section><h4 className="mb-2 text-xs font-bold uppercase">Adapter registry</h4><div className="space-y-2">{state?.adapters.slice().reverse().map(a=><div key={a.id} className="rounded border border-slate-200 p-3 text-xs dark:border-zinc-800"><strong>{a.specialty || a.domain} · {a.id}</strong><span className="float-right font-mono">{a.status}</span>{a.status==="CANDIDATE"&&<div className="mt-3 grid grid-cols-2 gap-2">{Object.keys(scores).map(key=><label key={key} className="grid gap-1 text-[10px] text-slate-500">{key.replace(/([A-Z])/g," $1")}<input className={control} type="number" min="0" max="1" step="0.01" value={scores[key as keyof typeof scores]} onChange={e=>setScores({...scores,[key]:e.target.value})}/></label>)}<button className={`${control} col-span-2`} onClick={()=>evaluate(a)}>Record independently reviewed scores</button></div>}<div className="mt-2 flex gap-2">{a.status==="EVALUATED"&&<button className={control} onClick={()=>post("/api/training/promotions/shadow",{adapterId:a.id},"Shadow promotion")}>Promote to shadow</button>}</div></div>)}{!state?.adapters.length&&<p className="text-xs text-slate-500">No trained adapter versions.</p>}</div></section></div>
    </div></details>;
}

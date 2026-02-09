'use client';

import { useState, useEffect, useRef } from 'react';
import JSZip from 'jszip';
import SiteAnalyzer from './components/SiteAnalyzer';
import PromptsTable from './components/PromptsTable';
import FavoritesPanel from './components/FavoritesPanel';
import type { FavoriteItem } from './components/FavoritesPanel';

async function safeFetch(url: string, options?: RequestInit): Promise<{ ok: boolean; data: any }> {
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    let data: any = {};
    try { data = JSON.parse(text); } catch { data = { error: 'Réponse inattendue du serveur' }; }
    return { ok: res.ok && !data.error, data };
  } catch { return { ok: false, data: { error: 'Connexion au serveur impossible' } }; }
}

const TABS = [
  { id: 'strategy', label: 'Stratégie', icon: '◆' },
  { id: 'prompts', label: 'Prompts', icon: '▤' },
  { id: 'assets', label: 'Assets', icon: '◎' },
  { id: 'studio', label: 'Studio', icon: '⬡' },
] as const;
type TabId = typeof TABS[number]['id'];

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>('strategy');
  const [showLogs, setShowLogs] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [currentPrompt, setCurrentPrompt] = useState<string>('');
  const [stats, setStats] = useState({ generated: 0, remaining: 0, total: 0 });
  const [autoMode, setAutoMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [productGroups, setProductGroups] = useState<{ [k: string]: { name: string; url: string }[] }>({});
  const [uploading, setUploading] = useState(false);
  const [showNewGroupModal, setShowNewGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [brandAssets, setBrandAssets] = useState<{ name: string; url: string; type: 'logo' | 'palette' | 'style' }[]>([]);
  const [uploadingBrand, setUploadingBrand] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<{ url: string; prompt: string; timestamp: number; mediaType?: string }[]>([]);
  const [batchCount, setBatchCount] = useState(1);
  const [videoPolling, setVideoPolling] = useState<{ operation: string; prompt: string; keyIndex?: number } | null>(null);
  const [includeText, setIncludeText] = useState(true);
  const [includeLogo, setIncludeLogo] = useState(false);

  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);

  const isGeneratingRef = useRef(false);
  const autoModeRef = useRef(false);
  const videoPollingRef = useRef(videoPolling);
  const promptsTableRef = useRef<{ reload: () => void }>(null);
  const autoTimerRef = useRef<NodeJS.Timeout | null>(null);
  const autoRetryCount = useRef(0);

  useEffect(() => { isGeneratingRef.current = isGenerating; }, [isGenerating]);
  useEffect(() => { autoModeRef.current = autoMode; }, [autoMode]);
  useEffect(() => { videoPollingRef.current = videoPolling; }, [videoPolling]);

  const addLog = (msg: string) => { setLogs(prev => [`[${new Date().toLocaleTimeString('fr-FR')}] ${msg}`, ...prev.slice(0, 49)]); };
  const handlePromptsGenerated = () => { loadStats(); promptsTableRef.current?.reload(); addLog('📋 Prompts ajoutés'); };

  // ── Favoris ──
  function addToFavorites(img: { url: string; prompt: string; timestamp: number; mediaType?: string }) {
    setFavorites(prev => {
      if (prev.some(f => f.prompt === img.prompt)) return prev;
      return [{ id: `fav-${img.timestamp}-${Math.random().toString(36).slice(2, 8)}`, ...img }, ...prev];
    });
  }
  function removeFavorite(id: string) { setFavorites(prev => prev.filter(f => f.id !== id)); }
  function clearAllFavorites() { if (confirm('Supprimer tous les favoris ?')) { setFavorites([]); localStorage.removeItem('favorites'); } }

  // ── Persistence ──
  useEffect(() => { favorites.length > 0 ? localStorage.setItem('favorites', JSON.stringify(favorites)) : localStorage.removeItem('favorites'); }, [favorites]);
  useEffect(() => { Object.keys(productGroups).length > 0 && localStorage.setItem('productGroups', JSON.stringify(productGroups)); }, [productGroups]);
  useEffect(() => { brandAssets.length > 0 && localStorage.setItem('brandAssets', JSON.stringify(brandAssets)); }, [brandAssets]);
  useEffect(() => {
    if (generatedImages.length > 0 && generatedImages.length < 20) {
      (async () => { try { const c = await Promise.all(generatedImages.map(async img => ({ ...img, url: img.mediaType === 'video' ? img.url : await compressImage(img.url) }))); localStorage.setItem('generatedImages', JSON.stringify(c)); localStorage.setItem('batchCount', batchCount.toString()); } catch {} })();
    } else if (generatedImages.length === 0) localStorage.removeItem('generatedImages');
  }, [generatedImages, batchCount]);

  // ── Init ──
  useEffect(() => {
    loadStats();
    const r = (k: string, s: (v: any) => void) => { const v = localStorage.getItem(k); if (v) try { s(JSON.parse(v)); } catch { localStorage.removeItem(k); } };
    r('productGroups', setProductGroups); r('brandAssets', setBrandAssets); r('generatedImages', setGeneratedImages); r('favorites', setFavorites); r('videoPolling', setVideoPolling);
    const b = localStorage.getItem('batchCount'); if (b) setBatchCount(parseInt(b));
  }, []);

  // ── Video polling ──
  useEffect(() => {
    if (!videoPolling) return;
    localStorage.setItem('videoPolling', JSON.stringify(videoPolling));
    addLog('🎬 Vidéo Veo en cours…');
    let stop = false, retries = 0;
    const poll = async () => {
      if (stop) return;
      const u = `/api/veo-poll?operation=${encodeURIComponent(videoPolling.operation)}&keyIndex=${videoPolling.keyIndex||0}`;
      const { ok, data } = await safeFetch(u);
      if (!ok || (data.success === false && data.error)) {
        const m = data.error || '';
        if (['bloqué','sécurité','expirée','introuvable','safety','filtered'].some(k => m.includes(k))) { addLog(`❌ ${m}`); setVideoPolling(null); localStorage.removeItem('videoPolling'); return; }
        if (++retries < 30) { setTimeout(poll, 15000); return; }
        addLog('⚠️ Vidéo Veo timeout'); setVideoPolling(null); localStorage.removeItem('videoPolling'); return;
      }
      if (data.success && data.done && data.videoUri) {
        addLog('✅ Vidéo Veo prête !'); setCurrentImage(data.videoUri); setCurrentPrompt(videoPolling.prompt);
        const ni = { url: data.videoUri, prompt: videoPolling.prompt, timestamp: Date.now(), mediaType: 'video' };
        setGeneratedImages(prev => { const up = [ni, ...prev]; if (up.length === 20) createAndDownloadZip(up, batchCount).then(s => { if (s) { setBatchCount(c => c+1); setGeneratedImages([]); localStorage.removeItem('generatedImages'); }}); return up; });
        setStats(prev => ({ ...prev, generated: prev.generated+1, remaining: prev.remaining-1 }));
        setVideoPolling(null); localStorage.removeItem('videoPolling'); loadStats();
      } else if (data.pending) { retries = 0; setTimeout(poll, 12000); }
      else if (++retries < 30) setTimeout(poll, 15000);
      else { setVideoPolling(null); localStorage.removeItem('videoPolling'); }
    };
    poll(); return () => { stop = true; };
  }, [videoPolling]);

  // ── Auto mode ──
  useEffect(() => { if (autoMode) scheduleNext(); return () => { if (autoTimerRef.current) clearTimeout(autoTimerRef.current); }; }, [autoMode]);
  function scheduleNext() {
    if (!autoModeRef.current) return;
    if (isGeneratingRef.current) { autoTimerRef.current = setTimeout(scheduleNext, 3000); return; }
    if (videoPollingRef.current) { autoTimerRef.current = setTimeout(scheduleNext, 5000); return; }
    generateSingle().then(() => { if (autoModeRef.current) { autoRetryCount.current = 0; autoTimerRef.current = setTimeout(scheduleNext, 3000); }})
    .catch(() => { if (autoModeRef.current) { autoRetryCount.current++; autoTimerRef.current = setTimeout(scheduleNext, Math.min(3000*Math.pow(2,autoRetryCount.current),30000)); }});
  }

  async function loadStats() { const { ok, data } = await safeFetch('/api/stats'); if (ok) setStats({ generated: data.generated||0, remaining: data.remaining||0, total: data.total||0 }); }

  async function generateSingle() {
    if (isGenerating) return;
    const tot = Object.values(productGroups).reduce((s,i) => s+i.length, 0);
    if (tot === 0) { setError('📸 Ajoute des images produit.'); setTimeout(() => setError(null), 5000); return; }
    setIsGenerating(true); setError(null); addLog('🎨 Génération…');
    try {
      const max = 10;
      const lg = Object.fromEntries(Object.entries(productGroups).map(([n,imgs]) => [n, imgs.slice(0, Math.ceil(max/Object.keys(productGroups).length))]));
      const { ok, data } = await safeFetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'single', productGroups: lg, brandAssets: brandAssets.map(a => ({ url: a.url, type: a.type })), includeText, includeLogo, videoEngine: 'veo' }) });
      if (!ok) { const m = data?.message||data?.error||''; if (m.includes('Aucun prompt')||m.includes('en attente')) { setError('✅ Tous les prompts générés !'); setAutoMode(false); } else setError('⏳ Serveur occupé…'); setTimeout(() => setError(null), 5000); return; }
      if (data.success) {
        if (data.videoOperation && !data.imageUrl) { setVideoPolling({ operation: data.videoOperation, prompt: data.prompt, keyIndex: data.videoKeyIndex||0 }); }
        else {
          const ni = { url: data.imageUrl, prompt: data.prompt, timestamp: Date.now(), mediaType: data.mediaType||'image' };
          setCurrentImage(data.imageUrl); setCurrentPrompt(data.prompt);
          setGeneratedImages(prev => { const u = [ni,...prev]; if (u.length===20) createAndDownloadZip(u,batchCount).then(s => { if (s) { setBatchCount(c=>c+1); setGeneratedImages([]); }}); return u; });
          setStats(prev => ({ generated: prev.generated+1, remaining: data.remaining, total: prev.total }));
          addLog('✅ Média généré');
        }
        promptsTableRef.current?.reload();
      } else { setError('⚠️ Génération échouée'); setTimeout(() => setError(null), 5000); }
    } catch { setError('📡 Connexion impossible'); setTimeout(() => setError(null), 5000); }
    finally { setIsGenerating(false); }
  }

  function toggleAutoMode() { if (autoMode) { setAutoMode(false); autoRetryCount.current = 0; } else setAutoMode(true); }

  // ── Groups ──
  function createNewGroup() { if (!newGroupName.trim() || productGroups[newGroupName]) return; setProductGroups(prev => ({ ...prev, [newGroupName]: [] })); setNewGroupName(''); setShowNewGroupModal(false); }
  function processFilesForGroup(g: string, files: FileList|File[]) {
    const arr = Array.from(files).filter(f => f.type.startsWith('image/')); if (!arr.length) return;
    setUploading(true); let d = 0;
    arr.forEach(f => { const r = new FileReader(); r.onload = async e => { const c = await compressImage(e.target?.result as string); setProductGroups(prev => ({ ...prev, [g]: [...(prev[g]||[]), { name: f.name, url: c }] })); if (++d >= arr.length) setUploading(false); }; r.readAsDataURL(f); });
  }
  function handleGroupImageUpload(g: string, e: React.ChangeEvent<HTMLInputElement>) { if (e.target.files?.length) processFilesForGroup(g, e.target.files); }
  function handleGroupDrop(g: string, e: React.DragEvent) { e.preventDefault(); e.stopPropagation(); setDragOverGroup(null); if (e.dataTransfer.files?.length) processFilesForGroup(g, e.dataTransfer.files); }
  function handleGroupDragOver(g: string, e: React.DragEvent) { e.preventDefault(); e.stopPropagation(); setDragOverGroup(g); }
  function handleGroupDragLeave(e: React.DragEvent) { e.preventDefault(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); if (e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom) setDragOverGroup(null); }
  function deleteGroupImage(g: string, n: string) { setProductGroups(prev => ({ ...prev, [g]: prev[g].filter(i => i.name !== n) })); }
  function deleteGroup(g: string) { if (confirm(`Supprimer "${g}" ?`)) setProductGroups(prev => { const x = { ...prev }; delete x[g]; return x; }); }
  function clearAllProductGroups() { if (confirm('Tout supprimer ?')) { setProductGroups({}); localStorage.removeItem('productGroups'); } }

  // ── Brand ──
  function handleBrandAssetUpload(e: React.ChangeEvent<HTMLInputElement>, type: 'logo'|'palette'|'style') {
    if (!e.target.files?.length) return;
    Array.from(e.target.files).forEach(f => { const r = new FileReader(); r.onload = ev => setBrandAssets(prev => [...prev, { name: f.name, url: ev.target?.result as string, type }]); r.readAsDataURL(f); });
  }
  function deleteBrandAsset(n: string) { setBrandAssets(prev => prev.filter(a => a.name !== n)); }
  function clearBrandAssets() { if (confirm('Supprimer ?')) { setBrandAssets([]); localStorage.removeItem('brandAssets'); } }

  // ── Utils ──
  async function compressImage(b64: string): Promise<string> {
    return new Promise(res => { const img = new Image(); img.onload = () => { const c = document.createElement('canvas'), ctx = c.getContext('2d')!; let w = img.width, h = img.height; const m = 600; if (w>h&&w>m) { h=(h*m)/w; w=m; } else if (h>m) { w=(w*m)/h; h=m; } c.width=w; c.height=h; ctx.drawImage(img,0,0,w,h); res(c.toDataURL('image/jpeg',0.5)); }; img.onerror = () => res(b64); img.src = b64; });
  }
  function downloadSingle(url: string, ts: number) { try { const a = document.createElement('a'); a.href=url; a.download=`meta-ad-${ts}.${url.startsWith('data:video')?'mp4':'png'}`; document.body.appendChild(a); a.click(); document.body.removeChild(a); } catch {} }
  function downloadAll() { if (generatedImages.length) createAndDownloadZip(generatedImages, batchCount); }
  function clearGallery() { if (confirm('Vider ?')) { setGeneratedImages([]); setCurrentImage(null); setCurrentPrompt(''); localStorage.removeItem('generatedImages'); } }
  function clearAllData() { if (confirm('Tout réinitialiser ?')) { setProductGroups({}); setBrandAssets([]); setGeneratedImages([]); setCurrentImage(null); setCurrentPrompt(''); setBatchCount(1); setVideoPolling(null); setFavorites([]); ['productGroups','brandAssets','generatedImages','batchCount','videoPolling','favorites','siteAnalyzerState'].forEach(k => localStorage.removeItem(k)); } }
  async function createAndDownloadZip(images: typeof generatedImages, batch: number) {
    try { const zip = new JSZip(); images.forEach((m,i) => { const v = m.mediaType==='video'||m.url.startsWith('data:video'); zip.file(`${v?'video':'image'}-${i+1}.${v?'mp4':'png'}`, m.url.split(',')[1], { base64: true }); }); const blob = await zip.generateAsync({ type: 'blob' }); const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`meta-ads-batch-${batch}.zip`; document.body.appendChild(a); a.click(); document.body.removeChild(a); return true; } catch { return false; }
  }

  const totalAssets = Object.values(productGroups).reduce((s,i) => s+i.length, 0);
  const progress = stats.total > 0 ? Math.round((stats.generated/stats.total)*100) : 0;
  const darkTheme = "[&_.bg-white]:bg-[#1a1a24] [&_.bg-white]:border [&_.bg-white]:border-white/[0.06] [&_.text-gray-600]:text-white/50 [&_.text-gray-700]:text-white/60 [&_.text-gray-800]:text-white/80 [&_.text-gray-500]:text-white/40 [&_.text-gray-400]:text-white/30 [&_.bg-gray-50]:bg-white/[0.03] [&_.bg-gray-100]:bg-white/[0.05] [&_.bg-gray-200]:bg-white/[0.08] [&_.bg-gray-300]:bg-white/10 [&_.border-gray-200]:border-white/[0.06] [&_.border-gray-300]:border-white/10 [&_.shadow-lg]:shadow-none [&_input]:bg-white/5 [&_input]:border-white/10 [&_input]:text-white [&_select]:bg-white/5 [&_select]:text-white [&_.rounded-2xl]:rounded-xl [&_table]:text-white/70 [&_th]:text-white/50 [&_td]:border-white/[0.04]";

  // ════════════ RENDER ════════════
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />

      {/* ═══ HEADER ═══ */}
      <header className="sticky top-0 z-50 bg-[#0a0a0f]/90 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-[1600px] mx-auto px-6">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🎨</span>
              <span className="text-xl font-bold bg-gradient-to-r from-violet-400 via-blue-400 to-pink-400 bg-clip-text text-transparent">Meta Ads Generator</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 bg-emerald-500/10 text-emerald-400 px-3 py-1.5 rounded-lg text-xs font-semibold"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>{stats.generated} générés</div>
              <div className="flex items-center gap-1.5 bg-amber-500/10 text-amber-400 px-3 py-1.5 rounded-lg text-xs font-semibold"><span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>{stats.remaining} restants</div>
              {stats.total > 0 && <div className="w-32 h-2 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-full transition-all duration-700" style={{ width: `${progress}%` }}></div></div>}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowLogs(!showLogs)} className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${showLogs ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/50'}`}>📋</button>
            </div>
          </div>

          <div className="flex gap-1">
            {TABS.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`px-5 py-3 text-sm font-medium rounded-t-lg transition-all ${activeTab === tab.id ? 'bg-[#13131a] text-white' : 'text-white/40 hover:text-white/60 hover:bg-white/[0.03]'}`}>
                <span className="mr-2 opacity-60">{tab.icon}</span>{tab.label}
                {((tab.id === 'studio' && generatedImages.length > 0) || (tab.id === 'prompts' && stats.total > 0)) && <span className="ml-2 w-1.5 h-1.5 rounded-full bg-violet-500 inline-block"></span>}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ═══ GENERATION BAR - toujours visible ═══ */}
      <div className="sticky top-[105px] z-40 bg-[#111118]/95 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-[1600px] mx-auto px-6 py-3">
          <div className="flex items-center gap-4">

            {/* Options claires */}
            <div className="flex items-center gap-3">
              <button onClick={() => setIncludeText(!includeText)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all border ${includeText ? 'bg-violet-500/15 border-violet-500/30 text-violet-300' : 'bg-white/[0.02] border-white/[0.06] text-white/30 hover:text-white/50'}`}>
                <span className={`w-3 h-3 rounded-sm flex items-center justify-center text-[8px] ${includeText ? 'bg-violet-500 text-white' : 'border border-white/20'}`}>{includeText ? '✓' : ''}</span>
                Avec texte
              </button>
              <button onClick={() => setIncludeLogo(!includeLogo)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all border ${includeLogo ? 'bg-violet-500/15 border-violet-500/30 text-violet-300' : 'bg-white/[0.02] border-white/[0.06] text-white/30 hover:text-white/50'}`}>
                <span className={`w-3 h-3 rounded-sm flex items-center justify-center text-[8px] ${includeLogo ? 'bg-violet-500 text-white' : 'border border-white/20'}`}>{includeLogo ? '✓' : ''}</span>
                Avec logo
              </button>

            </div>

            {/* Spacer */}
            <div className="flex-1"></div>

            {/* Dernier résultat inline */}
            {currentImage && (
              <div className="flex items-center gap-3 bg-white/[0.03] rounded-lg px-3 py-1.5 border border-white/[0.06]">
                <div className="w-10 h-10 rounded-md overflow-hidden border border-white/10 flex-shrink-0">
                  {currentImage.startsWith('data:video')
                    ? <video src={currentImage} className="w-full h-full object-cover" />
                    : <img src={currentImage} alt="" className="w-full h-full object-cover" />}
                </div>
                <div className="max-w-[200px]">
                  <p className="text-[10px] text-emerald-400 font-semibold">Dernier résultat</p>
                  <p className="text-[10px] text-white/30 line-clamp-1">{currentPrompt}</p>
                </div>
              </div>
            )}

            {/* Boutons de génération — PROÉMINENTS */}
            <button
              onClick={generateSingle}
              disabled={isGenerating || stats.remaining === 0}
              className="px-8 py-3 bg-gradient-to-r from-violet-600 to-fuchsia-600 rounded-xl text-base font-bold hover:from-violet-500 hover:to-fuchsia-500 disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:shadow-xl hover:shadow-violet-500/25 active:scale-95 flex items-center gap-2.5"
            >
              {isGenerating ? (
                <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>Génération…</>
              ) : (
                <><span className="text-lg">⚡</span>Générer</>
              )}
            </button>
            <button
              onClick={toggleAutoMode}
              disabled={stats.remaining === 0}
              className={`px-6 py-3 rounded-xl text-base font-bold transition-all active:scale-95 flex items-center gap-2 ${
                autoMode
                  ? 'bg-red-500/20 text-red-400 border-2 border-red-500/30 hover:bg-red-500/30 animate-pulse'
                  : 'bg-emerald-500/15 text-emerald-400 border-2 border-emerald-500/30 hover:bg-emerald-500/25'
              } disabled:opacity-30 disabled:cursor-not-allowed`}
            >
              {autoMode ? <><span>■</span>Stop</> : <><span>▶</span>Auto</>}
            </button>
          </div>

          {/* Status inline */}
          {(error || (autoMode && !error) || videoPolling) && (
            <div className="mt-2 space-y-1">
              {error && <div className={`px-4 py-2 rounded-lg text-xs font-medium ${error.includes('✅') ? 'bg-emerald-500/10 text-emerald-400' : error.includes('⏳') ? 'bg-amber-500/10 text-amber-400' : 'bg-red-500/10 text-red-400'}`}>{error}</div>}
              {autoMode && !error && <div className="px-4 py-2 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>Mode auto actif — génération continue</div>}
              {videoPolling && <div className="px-4 py-2 rounded-lg text-xs font-medium bg-blue-500/10 text-blue-400 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>Vidéo Veo en cours de création…</div>}
            </div>
          )}
        </div>
      </div>

      {/* ═══ MAIN ═══ */}
      <main className="flex-1 bg-[#13131a]">
        <div className="max-w-[1600px] mx-auto p-6">

          {activeTab === 'strategy' && (
            <div className="space-y-6">
              <div><h2 className="text-2xl font-bold tracking-tight">Stratégie de contenu</h2><p className="text-white/40 text-sm mt-1">Analyse un site et génère des prompts optimisés</p></div>
              <div className={darkTheme}><SiteAnalyzer onPromptsGenerated={handlePromptsGenerated} /></div>
            </div>
          )}

          {activeTab === 'prompts' && (
            <div className="space-y-6">
              <div><h2 className="text-2xl font-bold tracking-tight">Bibliothèque de prompts</h2><p className="text-white/40 text-sm mt-1">{stats.total} prompts • {stats.generated} générés • {stats.remaining} en attente</p></div>
              <div className={darkTheme}><PromptsTable ref={promptsTableRef} productGroups={Object.keys(productGroups)} /></div>
            </div>
          )}

          {activeTab === 'assets' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div><h2 className="text-2xl font-bold tracking-tight">Assets créatifs</h2><p className="text-white/40 text-sm mt-1">{Object.keys(productGroups).length} groupes • {totalAssets} images • {brandAssets.length} assets de marque</p></div>
                <button onClick={clearAllData} className="text-xs text-white/30 hover:text-red-400 transition-colors">Tout réinitialiser</button>
              </div>
              <div className="grid grid-cols-2 gap-6">
                {/* Produits */}
                <div className="bg-[#1a1a24] rounded-xl border border-white/[0.06] p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-white/80">📸 Produits</h3>
                    <div className="flex gap-2">
                      <button onClick={() => setShowNewGroupModal(true)} className="px-3 py-1.5 bg-violet-500/20 text-violet-400 text-xs rounded-lg font-semibold hover:bg-violet-500/30">+ Groupe</button>
                      {Object.keys(productGroups).length > 0 && <button onClick={clearAllProductGroups} className="px-3 py-1.5 bg-red-500/10 text-red-400 text-xs rounded-lg font-semibold hover:bg-red-500/20">Vider</button>}
                    </div>
                  </div>
                  {Object.keys(productGroups).length === 0 ? (
                    <div className="text-center py-12 rounded-xl border border-dashed border-white/10"><div className="text-4xl mb-3 opacity-40">📂</div><p className="text-white/30 text-sm">Crée un groupe pour commencer</p></div>
                  ) : (
                    <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                      {Object.entries(productGroups).map(([gn, images]) => (
                        <div key={gn} className={`rounded-lg p-3 border transition-all ${dragOverGroup === gn ? 'border-violet-500/50 bg-violet-500/5' : 'border-white/[0.06] bg-white/[0.02]'}`}
                          onDrop={e => handleGroupDrop(gn,e)} onDragOver={e => handleGroupDragOver(gn,e)} onDragLeave={handleGroupDragLeave}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-white/70">{gn} <span className="text-white/30">({images.length})</span></span>
                            <div className="flex gap-1">
                              <label className="cursor-pointer"><input type="file" multiple accept="image/*" onChange={e => handleGroupImageUpload(gn,e)} disabled={uploading} className="hidden" /><span className="px-2 py-1 bg-white/5 hover:bg-white/10 text-white/50 text-xs rounded font-medium cursor-pointer">+</span></label>
                              <button onClick={() => deleteGroup(gn)} className="px-2 py-1 text-white/20 hover:text-red-400 text-xs">✕</button>
                            </div>
                          </div>
                          {images.length > 0 ? (
                            <div className="grid grid-cols-5 gap-1.5">{images.map((img,i) => (
                              <div key={i} className="relative group aspect-square">
                                <img src={img.url} alt="" className="w-full h-full object-cover rounded" />
                                <button onClick={() => deleteGroupImage(gn,img.name)} className="absolute inset-0 bg-black/0 group-hover:bg-black/60 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"><span className="text-red-400 text-xs">✕</span></button>
                              </div>
                            ))}</div>
                          ) : <div className="text-center py-4 text-white/20 text-xs">Glisse des images ici</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* Charte */}
                <div className="bg-[#1a1a24] rounded-xl border border-white/[0.06] p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-white/80">🎨 Charte graphique</h3>
                    {brandAssets.length > 0 && <button onClick={clearBrandAssets} className="px-3 py-1.5 bg-red-500/10 text-red-400 text-xs rounded-lg font-semibold hover:bg-red-500/20">Vider</button>}
                  </div>
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    {([['logo','🏷️','Logo'],['palette','🎨','Palette'],['style','✨','Style']] as const).map(([type,icon,label]) => (
                      <label key={type} className="cursor-pointer">
                        <div className="border border-dashed border-white/10 hover:border-violet-500/30 rounded-lg p-4 text-center transition-all hover:bg-violet-500/5">
                          <input type="file" accept="image/*" multiple={type==='style'} onChange={e => handleBrandAssetUpload(e,type)} disabled={uploadingBrand} className="hidden" />
                          <div className="text-2xl mb-1">{icon}</div><p className="text-xs font-medium text-white/40">{label}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                  {brandAssets.length > 0 && (
                    <div className="grid grid-cols-4 gap-3">{brandAssets.map((a,i) => (
                      <div key={i} className="relative group"><img src={a.url} alt="" className="w-full h-20 object-contain bg-white/[0.03] rounded-lg p-2" />
                        <button onClick={() => deleteBrandAsset(a.name)} className="absolute inset-0 bg-black/0 group-hover:bg-black/60 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"><span className="text-red-400 text-xs">✕</span></button>
                      </div>
                    ))}</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'studio' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div><h2 className="text-2xl font-bold tracking-tight">Studio créatif</h2><p className="text-white/40 text-sm mt-1">{generatedImages.length} médias • {favorites.length} favoris</p></div>
                {generatedImages.length > 0 && (
                  <div className="flex gap-2">
                    <button onClick={downloadAll} className="px-4 py-2 bg-violet-500/20 text-violet-400 text-sm rounded-lg font-semibold hover:bg-violet-500/30">📦 ZIP</button>
                    <button onClick={clearGallery} className="px-4 py-2 bg-red-500/10 text-red-400 text-sm rounded-lg font-semibold hover:bg-red-500/20">🗑️ Vider</button>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-4 gap-6">
                {/* Dernier média - prominent */}
                <div className="col-span-1 bg-[#1a1a24] rounded-xl border border-white/[0.06] p-4">
                  <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Dernier résultat</h3>
                  {currentImage ? (
                    <div>
                      <div className="relative aspect-square rounded-lg overflow-hidden mb-3 border-2 border-violet-500/20 shadow-lg shadow-violet-500/10">
                        {currentImage.startsWith('data:video') ? <video src={currentImage} controls autoPlay loop className="w-full h-full object-cover" /> : <img src={currentImage} alt="" className="w-full h-full object-cover" />}
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                          <span className="text-[10px] font-semibold text-emerald-400">✓ Généré</span>
                        </div>
                      </div>
                      {currentPrompt && <p className="text-[11px] text-white/40 line-clamp-3 mb-3 leading-relaxed">{currentPrompt}</p>}
                      <div className="flex gap-2">
                        <button onClick={() => currentImage && addToFavorites({ url: currentImage, prompt: currentPrompt, timestamp: Date.now(), mediaType: currentImage.startsWith('data:video') ? 'video' : 'image' })} className="flex-1 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-xs rounded-lg font-semibold transition-colors">⭐ Favori</button>
                        <a href={currentImage} download={`meta-ad-${Date.now()}.png`} className="flex-1 py-2 bg-white/5 hover:bg-white/10 text-center rounded-lg text-xs font-medium text-white/60 transition-colors">📥</a>
                      </div>
                    </div>
                  ) : (
                    <div className="aspect-square rounded-lg bg-white/[0.02] border border-dashed border-white/10 flex items-center justify-center">
                      <div className="text-center"><div className="text-4xl mb-2 opacity-20">⬡</div><p className="text-white/20 text-xs">En attente</p></div>
                    </div>
                  )}
                </div>
                {/* Galerie */}
                <div className="col-span-3">
                  {generatedImages.length > 0 ? (
                    <div className="grid grid-cols-4 gap-3">
                      {generatedImages.map((img, i) => (
                        <div key={i} className="group bg-[#1a1a24] rounded-lg border border-white/[0.06] overflow-hidden hover:border-white/10 transition-all">
                          <div className="relative aspect-square">
                            {img.mediaType === 'video'
                              ? <video src={img.url} loop muted className="w-full h-full object-cover" onMouseEnter={e => (e.target as HTMLVideoElement).play()} onMouseLeave={e => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }} />
                              : <img src={img.url} alt="" className="w-full h-full object-cover" />}
                            {img.mediaType === 'video' && <div className="absolute top-2 right-2 bg-red-500/80 text-white px-1.5 py-0.5 rounded text-[9px] font-bold">VID</div>}
                          </div>
                          <div className="p-2">
                            <p className="text-[10px] text-white/30 line-clamp-1 mb-2">{img.prompt}</p>
                            <div className="flex gap-1">
                              <button onClick={() => addToFavorites(img)} className="flex-1 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-[11px] rounded font-medium transition-colors">⭐</button>
                              <button onClick={() => downloadSingle(img.url, img.timestamp)} className="flex-1 py-1.5 bg-white/5 hover:bg-white/10 text-white/40 text-[11px] rounded font-medium transition-colors">📥</button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-64 rounded-xl border border-dashed border-white/10">
                      <div className="text-center"><div className="text-5xl mb-3 opacity-15">⬡</div><p className="text-white/20 text-sm">Les médias apparaîtront ici</p><p className="text-white/10 text-xs mt-1">Utilise ⚡ Générer ou ▶ Auto</p></div>
                    </div>
                  )}
                </div>
              </div>
              {/* Favoris */}
              <div className={darkTheme}>
                <FavoritesPanel favorites={favorites} onRemove={removeFavorite} onClearAll={clearAllFavorites} onVariantsGenerated={handlePromptsGenerated} />
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ═══ LOG DRAWER ═══ */}
      {showLogs && (
        <div className="fixed right-0 top-0 bottom-0 w-96 bg-[#0a0a0f] border-l border-white/[0.06] z-[60] flex flex-col shadow-2xl shadow-black/50">
          <div className="flex items-center justify-between p-4 border-b border-white/[0.06]">
            <h3 className="font-semibold text-sm">📋 Journal</h3>
            <button onClick={() => setShowLogs(false)} className="text-white/30 hover:text-white/60 text-lg">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {logs.length === 0 ? <p className="text-white/20 text-xs text-center py-8">Aucune activité</p> : logs.map((log, i) => (
              <div key={i} className="text-[11px] text-white/40 py-2 px-3 rounded bg-white/[0.02] font-mono">{log}</div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ MODAL ═══ */}
      {showNewGroupModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70]">
          <div className="bg-[#1a1a24] rounded-xl p-6 max-w-sm w-full mx-4 border border-white/[0.06]">
            <h3 className="font-bold mb-4 text-white/80">Nouveau groupe</h3>
            <input type="text" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="Nom du groupe…" className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg mb-4 focus:border-violet-500/50 focus:outline-none text-sm text-white placeholder:text-white/20" onKeyDown={e => e.key==='Enter' && createNewGroup()} autoFocus />
            <div className="flex gap-2">
              <button onClick={createNewGroup} className="flex-1 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-sm font-semibold">Créer</button>
              <button onClick={() => { setShowNewGroupModal(false); setNewGroupName(''); }} className="flex-1 py-2 bg-white/5 hover:bg-white/10 text-white/60 rounded-lg text-sm font-medium">Annuler</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

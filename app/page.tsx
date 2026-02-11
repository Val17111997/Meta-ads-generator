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
  const [generatedImages, setGeneratedImages] = useState<{ url: string; prompt: string; timestamp: number; mediaType?: string; fileName?: string }[]>([]);
  const [batchCount, setBatchCount] = useState(1);
  const [videoPolling, setVideoPolling] = useState<{ operation: string; prompt: string; keyIndex?: number } | null>(null);
  const [includeText, setIncludeText] = useState(true);
  const [includeLogo, setIncludeLogo] = useState(false);

  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [productGroupUrls, setProductGroupUrls] = useState<{ [name: string]: string }>({});
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [galleryPage, setGalleryPage] = useState(1);
  const GALLERY_PER_PAGE = 20;

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
  const [favToast, setFavToast] = useState(false);

  function addToFavorites(img: { url: string; prompt: string; timestamp: number; mediaType?: string }) {
    setFavorites(prev => {
      if (prev.some(f => f.prompt === img.prompt)) return prev;
      const newFav = { id: `fav-${img.timestamp}-${Math.random().toString(36).slice(2, 8)}`, ...img };
      // Save to Supabase in background
      fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: img.url, prompt: img.prompt, mediaType: img.mediaType || 'image' }),
      }).then(r => r.json()).then(data => {
        if (data.success && data.id) {
          setFavorites(p => p.map(f => f.id === newFav.id ? { ...f, id: data.id } : f));
        }
      }).catch(() => {});
      // Toast + scroll to favorites
      setFavToast(true);
      setTimeout(() => setFavToast(false), 2000);
      setTimeout(() => {
        document.getElementById('favorites-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
      return [newFav, ...prev];
    });
  }
  function removeFavorite(id: string) {
    setFavorites(prev => prev.filter(f => f.id !== id));
    fetch('/api/favorites', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => {});
  }
  function clearAllFavorites() {
    if (confirm('Supprimer tous les favoris ?')) {
      setFavorites([]);
      fetch('/api/favorites', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'all' }) }).catch(() => {});
    }
  }

  // ── Persistence ──
  useEffect(() => { if (Object.keys(productGroups).length > 0) { try { localStorage.setItem('productGroups', JSON.stringify(productGroups)); } catch (e) { console.warn('⚠️ localStorage plein (productGroups)'); } } }, [productGroups]);
  useEffect(() => { Object.keys(productGroupUrls).length > 0 ? localStorage.setItem('productGroupUrls', JSON.stringify(productGroupUrls)) : localStorage.removeItem('productGroupUrls'); }, [productGroupUrls]);
  useEffect(() => { if (brandAssets.length > 0) { try { localStorage.setItem('brandAssets', JSON.stringify(brandAssets)); } catch { console.warn('⚠️ localStorage plein (brandAssets)'); } } }, [brandAssets]);
  // ── Gallery: save to Supabase (no more localStorage for images) ──
  async function saveToGallery(dataUrl: string, prompt: string, mediaType: string = 'image') {
    try {
      const res = await fetch('/api/gallery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl, prompt, mediaType }),
      });
      const data = await res.json();
      if (data.success) {
        return data.url; // Public URL from Supabase Storage
      }
      console.warn('⚠️ Gallery save failed:', data.error);
      return null;
    } catch (e) { console.error('Gallery save error:', e); return null; }
  }

  async function loadGallery() {
    try {
      const res = await fetch('/api/gallery');
      const data = await res.json();
      if (data.success && data.images) {
        setGeneratedImages(data.images);
      }
    } catch (e) { console.error('Gallery load error:', e); }
  }

  async function loadFavorites() {
    try {
      const res = await fetch('/api/favorites');
      const data = await res.json();
      if (data.success && data.favorites) {
        setFavorites(data.favorites);
      }
    } catch (e) { console.error('Favorites load error:', e); }
  }

  // ── Init ──
  useEffect(() => {
    loadStats();
    loadGallery();
    loadFavorites();
    const r = (k: string, s: (v: any) => void) => { const v = localStorage.getItem(k); if (v) try { s(JSON.parse(v)); } catch { localStorage.removeItem(k); } };
    r('productGroups', setProductGroups); r('productGroupUrls', setProductGroupUrls); r('brandAssets', setBrandAssets); r('videoPolling', setVideoPolling);
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
        setGeneratedImages(prev => [ni, ...prev]);
        setStats(prev => ({ ...prev, generated: prev.generated+1, remaining: prev.remaining-1 }));
        setVideoPolling(null); localStorage.removeItem('videoPolling'); loadStats();
        // Save to Supabase Storage in background
        saveToGallery(data.videoUri, videoPolling.prompt, 'video');
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
    if (tot === 0) { setError('📸 Aucune image produit uploadée. Va dans l\'onglet Assets, crée un groupe de produits et ajoute des photos.'); setTimeout(() => setError(null), 8000); return; }
    setIsGenerating(true); setError(null); addLog('🎨 Génération…');
    try {
      const max = 10;
      const lg = Object.fromEntries(Object.entries(productGroups).map(([n,imgs]) => [n, imgs.slice(0, Math.ceil(max/Object.keys(productGroups).length))]));
      const { ok, data } = await safeFetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'single', productGroups: lg, brandAssets: brandAssets.map(a => ({ url: a.url, type: a.type })), includeText, includeLogo, videoEngine: 'veo' }) });
      if (!ok) {
        const m = data?.message||data?.error||'';
        if (m.includes('Aucun prompt')||m.includes('en attente')) { setError('✅ Tous les prompts ont été générés !'); setAutoMode(false); }
        else if (m.includes('429') || m.includes('rate') || m.includes('Rate')) { setError('⏳ Trop de requêtes — les clés API sont temporairement limitées. Réessaie dans 1-2 minutes.'); }
        else if (m.includes('CLIENT_ID')) { setError('⚙️ CLIENT_ID non configuré. Contacte l\'administrateur.'); }
        else if (m.includes('GOOGLE_API_KEY')) { setError('🔑 Clé Google API manquante. Ajoute GOOGLE_API_KEY dans les variables Vercel.'); }
        else if (m) { setError(`⚠️ ${m}`); }
        else { setError('⏳ Serveur occupé, réessaie dans quelques secondes.'); }
        setTimeout(() => setError(null), 8000); return;
      }
      if (data.success) {
        if (data.videoOperation && !data.imageUrl) { setVideoPolling({ operation: data.videoOperation, prompt: data.prompt, keyIndex: data.videoKeyIndex||0 }); }
        else {
          const ni = { url: data.imageUrl, prompt: data.prompt, timestamp: Date.now(), mediaType: data.mediaType||'image' };
          setCurrentImage(data.imageUrl); setCurrentPrompt(data.prompt);
          setGeneratedImages(prev => [ni,...prev]);
          setStats(prev => ({ generated: prev.generated+1, remaining: data.remaining, total: prev.total }));
          addLog('✅ Média généré');
          // Save to Supabase Storage in background
          saveToGallery(data.imageUrl, data.prompt, data.mediaType || 'image');
        }
        promptsTableRef.current?.reload();
      } else {
        const m = data?.message||data?.error||'';
        if (m.includes('introuvable') && m.includes('Groupe')) { setError(`📂 ${m} — Va dans Assets et uploade des photos pour ce produit.`); }
        else if (m.includes('Aucune image')) { setError('📸 Aucune image disponible pour ce produit. Uploade des photos dans l\'onglet Assets.'); }
        else if (m.includes('Prompt vide')) { setError('✏️ Le prompt est vide. Vérifie tes prompts dans l\'onglet Prompts.'); }
        else if (m.includes('filtre') || m.includes('sécurité') || m.includes('bloqué')) { setError(`🚫 ${m}`); }
        else if (m.includes('Échec') && m.includes('clés')) { setError('🔑 Toutes les clés Google sont en rate limit. Attends quelques minutes ou ajoute une clé supplémentaire.'); }
        else if (m) { setError(`⚠️ ${m}`); }
        else { setError('⚠️ Génération échouée — consulte les logs (📋) pour plus de détails.'); }
        setTimeout(() => setError(null), 8000);
      }
    } catch { setError('📡 Connexion au serveur impossible. Vérifie ta connexion internet.'); setTimeout(() => setError(null), 8000); }
    finally { setIsGenerating(false); }
  }

  function toggleAutoMode() { if (autoMode) { setAutoMode(false); autoRetryCount.current = 0; } else setAutoMode(true); }

  // ── Groups ──
  function createNewGroup() { if (!newGroupName.trim() || productGroups[newGroupName]) return; setProductGroups(prev => ({ ...prev, [newGroupName]: [] })); setNewGroupName(''); setShowNewGroupModal(false); }
  function handleCreateGroups(groups: string[], urls?: { [name: string]: string }) {
    setProductGroups(prev => {
      const updated = { ...prev };
      groups.forEach(g => { if (!updated[g]) updated[g] = []; });
      return updated;
    });
    if (urls) {
      setProductGroupUrls(prev => ({ ...prev, ...urls }));
    }
  }
  function processFilesForGroup(g: string, files: FileList|File[]) {
    const arr = Array.from(files).filter(f => f.type.startsWith('image/')); if (!arr.length) return;
    setUploading(true); let d = 0;
    arr.forEach(f => { const r = new FileReader(); r.onload = async e => { try { const c = await compressImage(e.target?.result as string); setProductGroups(prev => ({ ...prev, [g]: [...(prev[g]||[]), { name: f.name, url: c }] })); } catch (err) { console.error('Erreur compression image:', f.name, err); } if (++d >= arr.length) setUploading(false); }; r.onerror = () => { console.error('Erreur lecture fichier:', f.name); if (++d >= arr.length) setUploading(false); }; r.readAsDataURL(f); });
  }
  function handleGroupImageUpload(g: string, e: React.ChangeEvent<HTMLInputElement>) { if (e.target.files?.length) processFilesForGroup(g, e.target.files); }
  function handleGroupDrop(g: string, e: React.DragEvent) { e.preventDefault(); e.stopPropagation(); setDragOverGroup(null); if (e.dataTransfer.files?.length) processFilesForGroup(g, e.dataTransfer.files); }
  function handleGroupDragOver(g: string, e: React.DragEvent) { e.preventDefault(); e.stopPropagation(); setDragOverGroup(g); }
  function handleGroupDragLeave(e: React.DragEvent) { e.preventDefault(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); if (e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom) setDragOverGroup(null); }
  function deleteGroupImage(g: string, n: string) { setProductGroups(prev => ({ ...prev, [g]: prev[g].filter(i => i.name !== n) })); }
  function deleteGroup(g: string) { if (confirm(`Supprimer "${g}" ?`)) setProductGroups(prev => { const x = { ...prev }; delete x[g]; return x; }); }
  function clearAllProductGroups() { if (confirm('Tout supprimer ?')) { setProductGroups({}); setProductGroupUrls({}); localStorage.removeItem('productGroups'); localStorage.removeItem('productGroupUrls'); } }

  // ── Brand ──
  function handleBrandAssetUpload(e: React.ChangeEvent<HTMLInputElement>, type: 'logo'|'palette'|'style') {
    if (!e.target.files?.length) return;
    Array.from(e.target.files).forEach(f => { const r = new FileReader(); r.onload = ev => { try { setBrandAssets(prev => [...prev, { name: f.name, url: ev.target?.result as string, type }]); } catch (err) { console.error('Erreur brand asset:', f.name, err); } }; r.onerror = () => console.error('Erreur lecture brand asset:', f.name); r.readAsDataURL(f); });
  }
  function deleteBrandAsset(n: string) { setBrandAssets(prev => prev.filter(a => a.name !== n)); }
  function clearBrandAssets() { if (confirm('Supprimer ?')) { setBrandAssets([]); localStorage.removeItem('brandAssets'); } }

  // ── Utils ──
  async function compressImage(b64: string): Promise<string> {
    return new Promise(res => { const img = new Image(); img.onload = () => { const c = document.createElement('canvas'), ctx = c.getContext('2d')!; let w = img.width, h = img.height; const m = 600; if (w>h&&w>m) { h=(h*m)/w; w=m; } else if (h>m) { w=(w*m)/h; h=m; } c.width=w; c.height=h; ctx.drawImage(img,0,0,w,h); res(c.toDataURL('image/jpeg',0.5)); }; img.onerror = () => res(b64); img.src = b64; });
  }
  function downloadSingle(url: string, ts: number) { try { const a = document.createElement('a'); a.href=url; a.download=`meta-ad-${ts}.${url.startsWith('data:video')?'mp4':'png'}`; document.body.appendChild(a); a.click(); document.body.removeChild(a); } catch {} }
  function downloadAll() { if (generatedImages.length) createAndDownloadZip(generatedImages, batchCount); }
  function clearGallery() {
    if (confirm('Vider la galerie ?')) {
      // Delete all from Supabase Storage
      generatedImages.forEach(img => {
        if ((img as any).fileName) {
          fetch('/api/gallery', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: (img as any).fileName }) }).catch(() => {});
        }
      });
      setGeneratedImages([]); setCurrentImage(null); setCurrentPrompt('');
    }
  }
  function clearAllData() { if (confirm('Tout réinitialiser ?')) { setProductGroups({}); setProductGroupUrls({}); setBrandAssets([]); setGeneratedImages([]); setCurrentImage(null); setCurrentPrompt(''); setBatchCount(1); setVideoPolling(null); setFavorites([]); ['productGroups','productGroupUrls','brandAssets','batchCount','videoPolling','siteAnalyzerState'].forEach(k => localStorage.removeItem(k)); fetch('/api/favorites', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'all' }) }).catch(() => {}); } }
  async function createAndDownloadZip(images: typeof generatedImages, batch: number) {
    try { const zip = new JSZip(); images.forEach((m,i) => { const v = m.mediaType==='video'||m.url.startsWith('data:video'); zip.file(`${v?'video':'image'}-${i+1}.${v?'mp4':'png'}`, m.url.split(',')[1], { base64: true }); }); const blob = await zip.generateAsync({ type: 'blob' }); const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`meta-ads-batch-${batch}.zip`; document.body.appendChild(a); a.click(); document.body.removeChild(a); return true; } catch { return false; }
  }

  const totalAssets = Object.values(productGroups).reduce((s,i) => s+i.length, 0);
  const progress = stats.total > 0 ? Math.round((stats.generated/stats.total)*100) : 0;

  // ════════════ RENDER ════════════
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 text-gray-800 flex flex-col" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />

      {/* ═══ HEADER ═══ */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-xl border-b border-gray-200 shadow-sm">
        <div className="max-w-[1600px] mx-auto px-6">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2.5">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <defs><linearGradient id="palGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#8b5cf6"/><stop offset="50%" stopColor="#6366f1"/><stop offset="100%" stopColor="#a855f7"/></linearGradient></defs>
                <path d="M12 2C6.49 2 2 6.49 2 12s4.49 10 10 10c1.38 0 2.5-1.12 2.5-2.5 0-.61-.23-1.2-.64-1.67-.08-.1-.13-.21-.13-.33 0-.28.22-.5.5-.5H16c3.31 0 6-2.69 6-6 0-4.96-4.49-9-10-9zM5.5 12c-.83 0-1.5-.67-1.5-1.5S4.67 9 5.5 9 7 9.67 7 10.5 6.33 12 5.5 12zm3-4C7.67 8 7 7.33 7 6.5S7.67 5 8.5 5s1.5.67 1.5 1.5S9.33 8 8.5 8zm7 0c-.83 0-1.5-.67-1.5-1.5S14.67 5 15.5 5s1.5.67 1.5 1.5S16.33 8 15.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S17.67 9 18.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" fill="url(#palGrad)"/>
              </svg>
              <span className="text-xl font-bold bg-gradient-to-r from-violet-600 via-blue-600 to-pink-600 bg-clip-text text-transparent">Meta Ads Generator</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 bg-emerald-50 text-emerald-600 px-3 py-1.5 rounded-lg text-xs font-semibold border border-emerald-200"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>{stats.generated} générés</div>
              <div className="flex items-center gap-1.5 bg-amber-50 text-amber-600 px-3 py-1.5 rounded-lg text-xs font-semibold border border-amber-200"><span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>{stats.remaining} restants</div>
              {stats.total > 0 && <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-full transition-all duration-700" style={{ width: `${progress}%` }}></div></div>}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowLogs(!showLogs)} className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${showLogs ? 'bg-gray-200 text-gray-700' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}>📋</button>
            </div>
          </div>

          <div className="flex gap-1">
            {TABS.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`px-5 py-3 text-sm font-medium rounded-t-lg transition-all ${activeTab === tab.id ? 'bg-gray-50 text-gray-800 border-b-2 border-violet-500' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'}`}>
                <span className="mr-2 opacity-50">{tab.icon}</span>{tab.label}
                {((tab.id === 'studio' && generatedImages.length > 0) || (tab.id === 'prompts' && stats.total > 0)) && <span className="ml-2 w-1.5 h-1.5 rounded-full bg-violet-500 inline-block"></span>}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ═══ GENERATION BAR ═══ */}
      <div className="sticky top-[105px] z-40 bg-white/95 backdrop-blur-xl border-b border-gray-200">
        <div className="max-w-[1600px] mx-auto px-6 py-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <button onClick={() => setIncludeText(!includeText)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all border ${includeText ? 'bg-violet-50 border-violet-300 text-violet-700' : 'bg-white border-gray-200 text-gray-400 hover:text-gray-600'}`}>
                <span className={`w-3 h-3 rounded-sm flex items-center justify-center text-[8px] ${includeText ? 'bg-violet-500 text-white' : 'border border-gray-300'}`}>{includeText ? '✓' : ''}</span>
                Avec texte
              </button>
              <button onClick={() => setIncludeLogo(!includeLogo)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all border ${includeLogo ? 'bg-violet-50 border-violet-300 text-violet-700' : 'bg-white border-gray-200 text-gray-400 hover:text-gray-600'}`}>
                <span className={`w-3 h-3 rounded-sm flex items-center justify-center text-[8px] ${includeLogo ? 'bg-violet-500 text-white' : 'border border-gray-300'}`}>{includeLogo ? '✓' : ''}</span>
                Avec logo
              </button>
            </div>
            <div className="flex-1"></div>
            {currentImage && (
              <div className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-1.5 border border-gray-200">
                <div className="w-10 h-10 rounded-md overflow-hidden border border-gray-200 flex-shrink-0">
                  {currentImage.startsWith('data:video') ? <video src={currentImage} className="w-full h-full object-cover" /> : <img src={currentImage} alt="" className="w-full h-full object-cover" />}
                </div>
                <div className="max-w-[200px]">
                  <p className="text-[10px] text-emerald-600 font-semibold">Dernier résultat</p>
                  <p className="text-[10px] text-gray-400 line-clamp-1">{currentPrompt}</p>
                </div>
              </div>
            )}
            <button onClick={generateSingle} disabled={isGenerating || stats.remaining === 0} className="px-8 py-3 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white rounded-xl text-base font-bold hover:from-violet-500 hover:to-fuchsia-500 disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:shadow-xl hover:shadow-violet-500/25 active:scale-95 flex items-center gap-2.5">
              {isGenerating ? (<><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>Génération…</>) : (<><span className="text-lg">⚡</span>Générer</>)}
            </button>
            <button onClick={toggleAutoMode} disabled={stats.remaining === 0} className={`px-6 py-3 rounded-xl text-base font-bold transition-all active:scale-95 flex items-center gap-2 ${autoMode ? 'bg-red-50 text-red-600 border-2 border-red-300 hover:bg-red-100 animate-pulse' : 'bg-emerald-50 text-emerald-600 border-2 border-emerald-300 hover:bg-emerald-100'} disabled:opacity-30 disabled:cursor-not-allowed`}>
              {autoMode ? <><span>■</span>Stop</> : <><span>▶</span>Auto</>}
            </button>
          </div>
          {(error || (autoMode && !error) || videoPolling) && (
            <div className="mt-2 space-y-1">
              {error && <div className={`px-4 py-2 rounded-lg text-xs font-medium ${error.includes('✅') ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : error.includes('⏳') ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{error}</div>}
              {autoMode && !error && <div className="px-4 py-2 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>Mode auto actif — génération continue</div>}
              {videoPolling && <div className="px-4 py-2 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>Vidéo Veo en cours de création…</div>}
            </div>
          )}
        </div>
      </div>

      {/* ═══ MAIN ═══ */}
      <main className="flex-1">
        <div className="max-w-[1600px] mx-auto p-6">

          {activeTab === 'strategy' && (
            <div className="space-y-6">
              <div><h2 className="text-2xl font-bold text-gray-800 tracking-tight">Stratégie de contenu</h2><p className="text-gray-400 text-sm mt-1">Analyse un site et génère des prompts optimisés</p></div>
              <SiteAnalyzer onPromptsGenerated={handlePromptsGenerated} productGroups={Object.keys(productGroups)} onCreateGroups={handleCreateGroups} productGroupUrls={productGroupUrls} />
            </div>
          )}

          {activeTab === 'prompts' && (
            <div className="space-y-6">
              <div><h2 className="text-2xl font-bold text-gray-800 tracking-tight">Bibliothèque de prompts</h2><p className="text-gray-400 text-sm mt-1">{stats.total} prompts • {stats.generated} générés • {stats.remaining} en attente</p></div>
              <PromptsTable ref={promptsTableRef} productGroups={Object.keys(productGroups)} />
            </div>
          )}

          {activeTab === 'assets' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div><h2 className="text-2xl font-bold text-gray-800 tracking-tight">Assets créatifs</h2><p className="text-gray-400 text-sm mt-1">{Object.keys(productGroups).length} groupes • {totalAssets} images • {brandAssets.length} assets de marque</p></div>
                <button onClick={clearAllData} className="text-xs text-gray-300 hover:text-red-500 transition-colors">Tout réinitialiser</button>
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-gray-700">📸 Produits</h3>
                    <div className="flex gap-2">
                      <button onClick={() => setShowNewGroupModal(true)} className="px-3 py-1.5 bg-violet-50 text-violet-600 text-xs rounded-lg font-semibold hover:bg-violet-100 border border-violet-200">+ Groupe</button>
                      {Object.keys(productGroups).length > 0 && <button onClick={clearAllProductGroups} className="px-3 py-1.5 bg-red-50 text-red-500 text-xs rounded-lg font-semibold hover:bg-red-100 border border-red-200">Vider</button>}
                    </div>
                  </div>
                  {Object.keys(productGroups).length === 0 ? (
                    <div className="text-center py-12 rounded-xl border-2 border-dashed border-gray-200"><div className="text-4xl mb-3 opacity-30">📂</div><p className="text-gray-400 text-sm">Crée un groupe pour commencer</p></div>
                  ) : (
                    <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                      {Object.entries(productGroups).map(([gn, images]) => (
                        <div key={gn} className={`rounded-lg p-3 border transition-all ${dragOverGroup === gn ? 'border-violet-400 bg-violet-50' : 'border-gray-200 bg-gray-50'}`}
                          onDrop={e => handleGroupDrop(gn,e)} onDragOver={e => handleGroupDragOver(gn,e)} onDragLeave={handleGroupDragLeave}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium text-sm text-gray-700">{gn} <span className="text-gray-400">({images.length})</span></span>
                            <div className="flex gap-1">
                              <button onClick={() => setActiveTab('strategy')} className="px-2 py-1 bg-purple-50 text-purple-600 rounded text-xs font-medium hover:bg-purple-100" title="Générer des prompts pour ce groupe">✨ Prompts</button>
                              <label className="px-2 py-1 bg-violet-100 text-violet-600 rounded text-xs cursor-pointer hover:bg-violet-200 font-medium">+ Photo<input type="file" className="hidden" accept="image/*" multiple onChange={e => handleGroupImageUpload(gn,e)} /></label>
                              <button onClick={() => deleteGroup(gn)} className="px-2 py-1 text-red-400 hover:text-red-600 text-xs">🗑️</button>
                            </div>
                          </div>
                          {images.length > 0 && (
                            <div className="grid grid-cols-4 gap-1.5">
                              {images.map((img,j) => (
                                <div key={j} className="relative group aspect-square rounded-md overflow-hidden border border-gray-200">
                                  <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                                  <button onClick={() => deleteGroupImage(gn, img.name)} className="absolute top-0.5 right-0.5 bg-red-500 text-white rounded-full w-4 h-4 text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                                </div>
                              ))}
                            </div>
                          )}
                          {images.length === 0 && <p className="text-xs text-gray-400 text-center py-4">Glisse ou ajoute des photos</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-gray-700">🎨 Charte graphique</h3>
                    {brandAssets.length > 0 && <button onClick={clearBrandAssets} className="px-3 py-1.5 bg-red-50 text-red-500 text-xs rounded-lg font-semibold hover:bg-red-100 border border-red-200">Vider</button>}
                  </div>
                  <div className="space-y-3">
                    {[{t:'logo' as const,l:'🏷️ Logo',d:'Logo PNG transparent'},{t:'palette' as const,l:'🎨 Palette',d:'Palette couleurs'},{t:'style' as const,l:'✨ Moodboard',d:'Exemples visuels'}].map(({t,l,d}) => (
                      <div key={t} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                        <div><span className="font-medium text-sm text-gray-700">{l}</span><p className="text-xs text-gray-400">{d}</p></div>
                        <div className="flex items-center gap-2">
                          {brandAssets.filter(a => a.type===t).map((a,i) => (
                            <div key={i} className="relative group w-10 h-10 rounded-md overflow-hidden border border-gray-200">
                              <img src={a.url} alt={a.name} className="w-full h-full object-cover" />
                              <button onClick={() => deleteBrandAsset(a.name)} className="absolute inset-0 bg-red-500/70 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                            </div>
                          ))}
                          <label className="px-3 py-1.5 bg-violet-50 text-violet-600 text-xs rounded-lg cursor-pointer hover:bg-violet-100 font-medium border border-violet-200">+<input type="file" className="hidden" accept="image/*" multiple onChange={e => handleBrandAssetUpload(e,t)} /></label>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'studio' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div><h2 className="text-2xl font-bold text-gray-800 tracking-tight">Studio créatif</h2><p className="text-gray-400 text-sm mt-1">{generatedImages.length} médias • {favorites.length} favoris</p></div>
                {generatedImages.length > 0 && (
                  <div className="flex gap-2">
                    <button onClick={downloadAll} className="px-4 py-2 bg-violet-50 text-violet-600 text-sm rounded-lg font-semibold hover:bg-violet-100 border border-violet-200">📦 ZIP</button>
                    <button onClick={clearGallery} className="px-4 py-2 bg-red-50 text-red-500 text-sm rounded-lg font-semibold hover:bg-red-100 border border-red-200">🗑️ Vider</button>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-4 gap-6">
                <div className="col-span-1 bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Dernier résultat</h3>
                  {currentImage ? (
                    <div>
                      <div className="relative aspect-square rounded-lg overflow-hidden mb-3 border-2 border-violet-200 shadow-lg shadow-violet-100">
                        {(currentImage.startsWith('data:video') || (currentImage.includes('/gallery/') && currentImage.endsWith('.mp4'))) ? <video src={currentImage} controls autoPlay loop className="w-full h-full object-cover" /> : <img src={currentImage} alt="" className="w-full h-full object-cover" />}
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/50 to-transparent p-2">
                          <span className="text-[10px] font-semibold text-emerald-400">✓ Généré</span>
                        </div>
                      </div>
                      {currentPrompt && <p className="text-[11px] text-gray-400 line-clamp-3 mb-3 leading-relaxed">{currentPrompt}</p>}
                      <div className="flex gap-2">
                        <button onClick={() => currentImage && addToFavorites({ url: currentImage, prompt: currentPrompt, timestamp: Date.now(), mediaType: currentImage.startsWith('data:video') ? 'video' : 'image' })} className="flex-1 py-2 bg-amber-50 hover:bg-amber-100 text-amber-600 text-xs rounded-lg font-semibold transition-colors border border-amber-200">⭐ Favori</button>
                        <a href={currentImage} download={`meta-ad-${Date.now()}.png`} className="flex-1 py-2 bg-gray-50 hover:bg-gray-100 text-center rounded-lg text-xs font-medium text-gray-500 transition-colors border border-gray-200">📥</a>
                      </div>
                    </div>
                  ) : (
                    <div className="aspect-square rounded-lg bg-gray-50 border-2 border-dashed border-gray-200 flex items-center justify-center">
                      <div className="text-center"><div className="text-4xl mb-2 opacity-20">⬡</div><p className="text-gray-300 text-xs">En attente</p></div>
                    </div>
                  )}
                </div>
                <div className="col-span-3">
                  {generatedImages.length > 0 ? (() => {
                    const totalPages = Math.ceil(generatedImages.length / GALLERY_PER_PAGE);
                    const paged = generatedImages.slice((galleryPage - 1) * GALLERY_PER_PAGE, galleryPage * GALLERY_PER_PAGE);
                    return (
                      <>
                        <div className="grid grid-cols-4 gap-3">
                          {paged.map((img, i) => (
                            <div key={i} className="group bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:border-violet-300 hover:shadow-md transition-all">
                              <div className="relative aspect-square">
                                {(img.mediaType === 'video' || img.url.endsWith('.mp4'))
                                  ? <video src={img.url} loop muted className="w-full h-full object-cover" onMouseEnter={e => (e.target as HTMLVideoElement).play()} onMouseLeave={e => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }} />
                                  : <img src={img.url} alt="" className="w-full h-full object-cover" />}
                                {(img.mediaType === 'video' || img.url.endsWith('.mp4')) && <div className="absolute top-2 right-2 bg-red-500 text-white px-1.5 py-0.5 rounded text-[9px] font-bold">VID</div>}
                              </div>
                              <div className="p-2">
                                <p className="text-[10px] text-gray-400 line-clamp-1 mb-2">{img.prompt}</p>
                                <div className="flex gap-1">
                                  <button onClick={() => addToFavorites(img)} className="flex-1 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-600 text-[11px] rounded font-medium transition-colors">⭐</button>
                                  <button onClick={() => downloadSingle(img.url, img.timestamp)} className="flex-1 py-1.5 bg-gray-50 hover:bg-gray-100 text-gray-400 text-[11px] rounded font-medium transition-colors">📥</button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                        {totalPages > 1 && (
                          <div className="flex items-center justify-center gap-2 mt-4">
                            <button
                              onClick={() => setGalleryPage(p => Math.max(1, p - 1))}
                              disabled={galleryPage === 1}
                              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                              ← Préc
                            </button>
                            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                              <button
                                key={p}
                                onClick={() => setGalleryPage(p)}
                                className={`w-8 h-8 rounded-lg text-sm font-semibold transition-all ${
                                  galleryPage === p
                                    ? 'bg-violet-500 text-white shadow-md'
                                    : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                                }`}
                              >
                                {p}
                              </button>
                            ))}
                            <button
                              onClick={() => setGalleryPage(p => Math.min(totalPages, p + 1))}
                              disabled={galleryPage === totalPages}
                              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                              Suiv →
                            </button>
                          </div>
                        )}
                      </>
                    );
                  })() : (
                    <div className="flex items-center justify-center h-64 rounded-xl border-2 border-dashed border-gray-200">
                      <div className="text-center"><div className="text-5xl mb-3 opacity-15">⬡</div><p className="text-gray-300 text-sm">Les médias apparaîtront ici</p><p className="text-gray-200 text-xs mt-1">Utilise ⚡ Générer ou ▶ Auto</p></div>
                    </div>
                  )}
                </div>
              </div>
              <div id="favorites-section">
                <FavoritesPanel favorites={favorites} onRemove={removeFavorite} onClearAll={clearAllFavorites} onVariantsGenerated={handlePromptsGenerated} />
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ═══ FAV TOAST ═══ */}
      {favToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] animate-bounce">
          <div className="bg-amber-500 text-white px-5 py-2.5 rounded-full shadow-lg shadow-amber-200 text-sm font-semibold flex items-center gap-2">
            ⭐ Ajouté aux favoris ↓
          </div>
        </div>
      )}

      {/* ═══ LOG DRAWER ═══ */}
      {showLogs && (
        <div className="fixed right-0 top-0 bottom-0 w-96 bg-white border-l border-gray-200 z-[60] flex flex-col shadow-2xl">
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
            <h3 className="font-semibold text-sm text-gray-700">📋 Journal</h3>
            <button onClick={() => setShowLogs(false)} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {logs.length === 0 ? <p className="text-gray-300 text-xs text-center py-8">Aucune activité</p> : logs.map((log, i) => (
              <div key={i} className="text-[11px] text-gray-500 py-2 px-3 rounded bg-gray-50 font-mono">{log}</div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ MODAL ═══ */}
      {showNewGroupModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[70]">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl border border-gray-200">
            <h3 className="font-bold mb-4 text-gray-700">Nouveau groupe</h3>
            <input type="text" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="Nom du groupe…" className="w-full px-4 py-2.5 border border-gray-300 rounded-lg mb-4 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200 text-sm" onKeyDown={e => e.key==='Enter' && createNewGroup()} autoFocus />
            <div className="flex gap-2">
              <button onClick={createNewGroup} className="flex-1 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-sm font-semibold">Créer</button>
              <button onClick={() => { setShowNewGroupModal(false); setNewGroupName(''); }} className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-sm font-medium">Annuler</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

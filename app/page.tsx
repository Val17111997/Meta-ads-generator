'use client';

import { useState, useEffect, useRef } from 'react';
import JSZip from 'jszip';
import SiteAnalyzer from './components/SiteAnalyzer';
import PromptsTable from './components/PromptsTable';

// ============================================================
// Helper : fetch sécurisé — ne throw jamais, retourne toujours du JSON
// ============================================================
async function safeFetch(url: string, options?: RequestInit): Promise<{ ok: boolean; data: any }> {
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    let data: any = {};
    try { data = JSON.parse(text); } catch { data = { error: 'Réponse inattendue du serveur' }; }
    return { ok: res.ok && !data.error, data };
  } catch {
    return { ok: false, data: { error: 'Connexion au serveur impossible' } };
  }
}

export default function Home() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [currentPrompt, setCurrentPrompt] = useState<string>('');
  const [stats, setStats] = useState({ generated: 0, remaining: 0, total: 0 });
  const [autoMode, setAutoMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [productGroups, setProductGroups] = useState<{ [groupName: string]: { name: string; url: string }[] }>({});
  const [uploading, setUploading] = useState(false);
  const [showNewGroupModal, setShowNewGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [brandAssets, setBrandAssets] = useState<{ name: string; url: string; type: 'logo' | 'palette' | 'style' }[]>([]);
  const [uploadingBrand, setUploadingBrand] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<{ url: string; prompt: string; timestamp: number; mediaType?: string }[]>([]);
  const [batchCount, setBatchCount] = useState(1);
  const [videoPolling, setVideoPolling] = useState<{ operation: string; prompt: string } | null>(null);
  const [includeText, setIncludeText] = useState(true);
  const [includeLogo, setIncludeLogo] = useState(false);
  const [videoEngine, setVideoEngine] = useState<'veo' | 'kling'>('veo');
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);

  const isGeneratingRef = useRef(false);
  const autoModeRef = useRef(false);
  const videoPollingRef = useRef(videoPolling);

  useEffect(() => { isGeneratingRef.current = isGenerating; }, [isGenerating]);
  useEffect(() => { autoModeRef.current = autoMode; }, [autoMode]);
  useEffect(() => { videoPollingRef.current = videoPolling; }, [videoPolling]);

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString('fr-FR');
    setLogs(prev => [`[${timestamp}] ${message}`, ...prev.slice(0, 19)]);
  };

  // Messages user-friendly (jamais de messages techniques)
  const USER_MESSAGES = {
    serverBusy: '⏳ Le serveur est occupé, nouvelle tentative automatique…',
    networkError: '📡 Problème de connexion, nouvelle tentative…',
    generationFailed: '⚠️ La génération n\'a pas abouti, réessaie dans un instant.',
    noPrompts: '✅ Tous les prompts ont été générés !',
    noImages: '📸 Ajoute des images produit pour commencer.',
  };

  useEffect(() => {
    loadStats();
    addLog('🚀 Application démarrée');
    
    const savedProductGroups = localStorage.getItem('productGroups');
    if (savedProductGroups) {
      try {
        const parsed = JSON.parse(savedProductGroups);
        setProductGroups(parsed);
        const totalImages = Object.values(parsed).reduce((sum: number, imgs: any) => sum + imgs.length, 0);
        addLog(`📦 ${Object.keys(parsed).length} groupe(s) restauré(s) (${totalImages} images)`);
      } catch (e) {
        console.error('Erreur restauration groupes produits:', e);
      }
    }
    
    const savedBrandAssets = localStorage.getItem('brandAssets');
    if (savedBrandAssets) {
      try {
        const parsed = JSON.parse(savedBrandAssets);
        setBrandAssets(parsed);
        addLog(`🎨 ${parsed.length} asset(s) de marque restauré(s)`);
      } catch (e) {
        console.error('Erreur restauration assets marque:', e);
      }
    }
    
    const savedGeneratedImages = localStorage.getItem('generatedImages');
    if (savedGeneratedImages) {
      try {
        const parsed = JSON.parse(savedGeneratedImages);
        setGeneratedImages(parsed);
        addLog(`🖼️ ${parsed.length} média(s) généré(s) restauré(s)`);
      } catch (e) {
        console.error('Erreur restauration images générées:', e);
        localStorage.removeItem('generatedImages');
      }
    }
    
    const savedBatchCount = localStorage.getItem('batchCount');
    if (savedBatchCount) {
      setBatchCount(parseInt(savedBatchCount));
    }

    const savedVideoPolling = localStorage.getItem('videoPolling');
    if (savedVideoPolling) {
      try {
        const parsed = JSON.parse(savedVideoPolling);
        setVideoPolling(parsed);
        addLog(`🎬 Polling vidéo repris`);
      } catch (e) {
        localStorage.removeItem('videoPolling');
      }
    }
  }, []);

  useEffect(() => {
    if (!videoPolling) return;
    localStorage.setItem('videoPolling', JSON.stringify(videoPolling));
    const isKling = videoPolling.operation.startsWith('kling:');
    const engineLabel = isKling ? 'Kling' : 'Veo';
    addLog(`🎬 Vidéo ${engineLabel} en cours de génération…`);
    let stopped = false;
    let retryCount = 0;
    const maxRetries = 30; // ~6 min max de polling

    const pollOnce = async () => {
      if (stopped) return;
      
      let pollUrl: string;
      if (isKling) {
        const taskId = videoPolling.operation.replace('kling:', '');
        pollUrl = `/api/kling-poll?taskId=${encodeURIComponent(taskId)}`;
      } else {
        pollUrl = `/api/veo-poll?operation=${encodeURIComponent(videoPolling.operation)}`;
      }
      
      const { ok, data } = await safeFetch(pollUrl);
      
      if (!ok && !data.pending) {
        retryCount++;
        if (retryCount < maxRetries) {
          setTimeout(pollOnce, 15000);
          return;
        }
        addLog(`⚠️ La vidéo ${engineLabel} prend trop de temps, réessaie plus tard.`);
        setVideoPolling(null);
        localStorage.removeItem('videoPolling');
        return;
      }
      
      if (data.success && data.done && data.videoUri) {
        addLog(`✅ Vidéo ${engineLabel} générée avec succès !`);
        setCurrentImage(data.videoUri);
        setCurrentPrompt(videoPolling.prompt);
        const newImage = { url: data.videoUri, prompt: videoPolling.prompt, timestamp: Date.now(), mediaType: 'video' };
        setGeneratedImages(prev => {
          const updated = [newImage, ...prev];
          if (updated.length === 20) {
            createAndDownloadZip(updated, batchCount).then(success => {
              if (success) { setBatchCount(c => c + 1); setGeneratedImages([]); localStorage.removeItem('generatedImages'); }
            });
          }
          return updated;
        });
        setStats(prev => ({ ...prev, generated: prev.generated + 1, remaining: prev.remaining - 1 }));
        setVideoPolling(null);
        localStorage.removeItem('videoPolling');
        loadStats();
      } else if (data.pending) {
        retryCount = 0;
        const pollInterval = isKling ? 10000 : 12000; // Kling is a bit faster
        setTimeout(pollOnce, pollInterval);
      } else {
        retryCount++;
        if (retryCount < maxRetries) {
          setTimeout(pollOnce, 15000);
        } else {
          addLog(`⚠️ La vidéo ${engineLabel} n'a pas pu être générée.`);
          setVideoPolling(null);
          localStorage.removeItem('videoPolling');
        }
      }
    };
    pollOnce();
    return () => { stopped = true; };
  }, [videoPolling]);

  useEffect(() => {
    if (Object.keys(productGroups).length > 0) {
      try { localStorage.setItem('productGroups', JSON.stringify(productGroups)); } 
      catch (e) { /* silencieux */ }
    }
  }, [productGroups]);

  useEffect(() => {
    if (brandAssets.length > 0) {
      try { localStorage.setItem('brandAssets', JSON.stringify(brandAssets)); } 
      catch (e) { /* silencieux */ }
    }
  }, [brandAssets]);

  useEffect(() => {
    if (generatedImages.length > 0 && generatedImages.length < 20) {
      const saveCompressed = async () => {
        try {
          const compressed = await Promise.all(generatedImages.map(async (img) => ({
            ...img, url: img.mediaType === 'video' ? img.url : await compressImage(img.url)
          })));
          localStorage.setItem('generatedImages', JSON.stringify(compressed));
          localStorage.setItem('batchCount', batchCount.toString());
        } catch (e) { /* silencieux */ }
      };
      saveCompressed();
    } else if (generatedImages.length === 0) {
      localStorage.removeItem('generatedImages');
    }
  }, [generatedImages, batchCount]);

  useEffect(() => {
    if (autoMode) { scheduleNext(); }
    return () => { if (autoTimerRef.current) { clearTimeout(autoTimerRef.current); autoTimerRef.current = null; } };
  }, [autoMode]);

  const autoTimerRef = useRef<NodeJS.Timeout | null>(null);
  const autoRetryCount = useRef(0);

  function scheduleNext() {
    if (!autoModeRef.current) return;
    if (isGeneratingRef.current) { autoTimerRef.current = setTimeout(scheduleNext, 3000); return; }
    if (videoPollingRef.current) { autoTimerRef.current = setTimeout(scheduleNext, 5000); return; }
    generateSingle().then(() => { 
      if (autoModeRef.current) { 
        autoRetryCount.current = 0;
        autoTimerRef.current = setTimeout(scheduleNext, 3000); 
      } 
    }).catch(() => {
      if (autoModeRef.current) {
        autoRetryCount.current++;
        const delay = Math.min(3000 * Math.pow(2, autoRetryCount.current), 30000);
        autoTimerRef.current = setTimeout(scheduleNext, delay);
      }
    });
  }

  async function loadStats() {
    const { ok, data } = await safeFetch('/api/stats');
    if (ok) {
      setStats({ generated: data.generated || 0, remaining: data.remaining || 0, total: data.total || 0 });
      addLog(`📊 Stats: ${data.total || 0} prompts, ${data.remaining || 0} en attente`);
    }
  }

  async function generateSingle() {
    if (isGenerating) return;
    const totalImages = Object.values(productGroups).reduce((sum, imgs) => sum + imgs.length, 0);
    if (totalImages === 0) { setError(USER_MESSAGES.noImages); setTimeout(() => setError(null), 5000); return; }
    
    setIsGenerating(true);
    setError(null);
    addLog('🎨 Génération en cours…');
    
    try {
      const maxImages = 10;
      const limitedGroups = Object.fromEntries(
        Object.entries(productGroups).map(([name, images]) => [name, images.slice(0, Math.ceil(maxImages / Object.keys(productGroups).length))])
      );
      
      const { ok, data } = await safeFetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'single', productGroups: limitedGroups, brandAssets: brandAssets.map(asset => ({ url: asset.url, type: asset.type })), includeText, includeLogo, videoEngine }),
      });
      
      if (!ok) {
        const msg = data?.message || data?.error || '';
        if (msg.includes('Aucun prompt') || msg.includes('en attente')) {
          setError(USER_MESSAGES.noPrompts);
          setAutoMode(false);
        } else {
          setError(USER_MESSAGES.serverBusy);
          addLog('⏳ Serveur occupé, réessaie…');
        }
        setTimeout(() => setError(null), 5000);
        return;
      }
      
      if (data.success) {
        if (data.videoOperation && !data.imageUrl) {
          addLog(`🎬 Vidéo en cours de création…`);
          setVideoPolling({ operation: data.videoOperation, prompt: data.prompt });
        } else {
          const newImage = { url: data.imageUrl, prompt: data.prompt, timestamp: Date.now(), mediaType: data.mediaType || 'image' };
          setCurrentImage(data.imageUrl);
          setCurrentPrompt(data.prompt);
          setGeneratedImages(prev => {
            const updated = [newImage, ...prev];
            if (updated.length === 20) { createAndDownloadZip(updated, batchCount).then(success => { if (success) { setBatchCount(c => c + 1); setGeneratedImages([]); } }); }
            return updated;
          });
          setStats(prev => ({ generated: prev.generated + 1, remaining: data.remaining, total: prev.total }));
          addLog(`✅ Média généré avec succès`);
        }
      } else {
        const msg = data.message || '';
        if (msg.includes('Aucun prompt') || msg.includes('en attente')) {
          setError(USER_MESSAGES.noPrompts);
          setAutoMode(false);
        } else if (msg.includes('introuvable')) {
          setError(`📦 Groupe de produit non trouvé. Vérifie tes groupes.`);
        } else {
          setError(USER_MESSAGES.generationFailed);
        }
        setTimeout(() => setError(null), 5000);
      }
    } catch {
      setError(USER_MESSAGES.networkError);
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsGenerating(false);
    }
  }

  function toggleAutoMode() {
    if (autoMode) { setAutoMode(false); addLog('⏸️ Mode auto arrêté'); autoRetryCount.current = 0; } 
    else { setAutoMode(true); addLog('🚀 Mode auto démarré'); }
  }

  function createNewGroup() {
    if (!newGroupName.trim()) { alert('⚠️ Donne un nom au groupe !'); return; }
    if (productGroups[newGroupName]) { alert('⚠️ Ce nom existe déjà !'); return; }
    setProductGroups(prev => ({ ...prev, [newGroupName]: [] }));
    addLog(`📁 Groupe "${newGroupName}" créé`);
    setNewGroupName('');
    setShowNewGroupModal(false);
  }

  function processFilesForGroup(groupName: string, files: FileList | File[]) {
    const fileArray = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (fileArray.length === 0) return;
    setUploading(true);
    addLog(`📤 Upload de ${fileArray.length} image(s)…`);
    let processed = 0;
    fileArray.forEach(file => {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = event.target?.result as string;
        const compressed = await compressImage(base64);
        setProductGroups(prev => ({ ...prev, [groupName]: [...(prev[groupName] || []), { name: file.name, url: compressed }] }));
        addLog(`✅ ${file.name} ajouté`);
        processed++;
        if (processed >= fileArray.length) setUploading(false);
      };
      reader.readAsDataURL(file);
    });
  }

  function handleGroupImageUpload(groupName: string, e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    processFilesForGroup(groupName, files);
  }

  function handleGroupDrop(groupName: string, e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverGroup(null);
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    processFilesForGroup(groupName, files);
  }

  function handleGroupDragOver(groupName: string, e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverGroup(groupName);
  }

  function handleGroupDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    // Seulement si on quitte vraiment la zone (pas un enfant)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX, y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDragOverGroup(null);
    }
  }

  function deleteGroupImage(groupName: string, imageName: string) {
    setProductGroups(prev => ({ ...prev, [groupName]: prev[groupName].filter(img => img.name !== imageName) }));
  }

  function deleteGroup(groupName: string) {
    if (confirm(`Supprimer "${groupName}" ?`)) {
      setProductGroups(prev => { const g = { ...prev }; delete g[groupName]; return g; });
      addLog(`🗑️ Groupe supprimé`);
    }
  }

  function clearAllProductGroups() {
    if (confirm('Supprimer tous les groupes ?')) { setProductGroups({}); localStorage.removeItem('productGroups'); addLog('🗑️ Groupes effacés'); }
  }

  function handleBrandAssetUpload(e: React.ChangeEvent<HTMLInputElement>, type: 'logo' | 'palette' | 'style') {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploadingBrand(true);
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        setBrandAssets(prev => [...prev, { name: file.name, url: event.target?.result as string, type }]);
        addLog(`✅ ${file.name} uploadé`);
      };
      reader.readAsDataURL(file);
    });
    setUploadingBrand(false);
  }

  function deleteBrandAsset(name: string) { setBrandAssets(prev => prev.filter(a => a.name !== name)); }
  function clearBrandAssets() { if (confirm('Supprimer la charte ?')) { setBrandAssets([]); localStorage.removeItem('brandAssets'); addLog('🗑️ Charte effacée'); } }

  async function compressImage(base64: string): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        const maxSize = 600;
        let w = img.width, h = img.height;
        if (w > h && w > maxSize) { h = (h * maxSize) / w; w = maxSize; } 
        else if (h > maxSize) { w = (w * maxSize) / h; h = maxSize; }
        canvas.width = w; canvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.5));
      };
      img.onerror = () => resolve(base64);
      img.src = base64;
    });
  }

  function downloadSingleImage(url: string, prompt: string, ts: number) {
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = `meta-ad-${ts}.${url.startsWith('data:video') ? 'mp4' : 'png'}`;
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
    } catch { /* silencieux */ }
  }

  function downloadAllImages() {
    if (generatedImages.length === 0) return;
    addLog(`📦 Création ZIP…`);
    createAndDownloadZip(generatedImages, batchCount);
  }

  function clearAllData() {
    if (confirm('Tout supprimer ?')) {
      setProductGroups({}); setBrandAssets([]); setGeneratedImages([]); setCurrentImage(null); setCurrentPrompt(''); setBatchCount(1); setVideoPolling(null);
      localStorage.removeItem('productGroups'); localStorage.removeItem('brandAssets'); localStorage.removeItem('generatedImages'); localStorage.removeItem('batchCount'); localStorage.removeItem('videoPolling');
      addLog('🗑️ Tout effacé');
    }
  }

  function clearGeneratedImages() {
    if (confirm('Vider la galerie ?')) { setGeneratedImages([]); setCurrentImage(null); setCurrentPrompt(''); localStorage.removeItem('generatedImages'); addLog('🗑️ Galerie vidée'); }
  }

  async function createAndDownloadZip(images: typeof generatedImages, batch: number) {
    try {
      const zip = new JSZip();
      for (let i = 0; i < images.length; i++) {
        const m = images[i];
        const isVideo = m.mediaType === 'video' || m.url.startsWith('data:video');
        zip.file(`${isVideo ? 'video' : 'image'}-${i + 1}.${isVideo ? 'mp4' : 'png'}`, m.url.split(',')[1], { base64: true });
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `meta-ads-batch-${batch}.zip`;
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
      addLog(`✅ ZIP téléchargé`);
      return true;
    } catch (e) { addLog('⚠️ Erreur lors du téléchargement'); return false; }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-pink-50 p-4">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-8 mt-8">
          <h1 className="text-6xl font-bold mb-3 bg-gradient-to-r from-purple-600 via-blue-600 to-pink-600 bg-clip-text text-transparent">🎨 Meta Ads Generator</h1>
          <p className="text-gray-600 text-lg">Powered by Google Gemini AI + Supabase</p>
        </div>

        <SiteAnalyzer />
        <PromptsTable productGroups={Object.keys(productGroups)} />

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow-lg p-6 text-center hover:scale-105 transition-transform">
            <div className="text-5xl font-bold text-green-600 mb-2">{stats.generated}</div>
            <div className="text-sm text-gray-600 uppercase">✅ Générés</div>
          </div>
          <div className="bg-white rounded-xl shadow-lg p-6 text-center hover:scale-105 transition-transform">
            <div className="text-5xl font-bold text-orange-600 mb-2">{stats.remaining}</div>
            <div className="text-sm text-gray-600 uppercase">⏳ En attente</div>
          </div>
          <div className="bg-white rounded-xl shadow-lg p-6 text-center hover:scale-105 transition-transform">
            <div className="text-5xl font-bold text-blue-600 mb-2">{stats.total}</div>
            <div className="text-sm text-gray-600 uppercase">📊 Total</div>
          </div>
        </div>

        <div className="mb-6">
          <button onClick={loadStats} disabled={isGenerating} className="w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-xl font-semibold transition-all hover:scale-105 active:scale-95 shadow-lg disabled:opacity-50">
            🔄 Actualiser les stats
          </button>
        </div>

        {stats.total === 0 && (
          <div className="mb-6 bg-yellow-50 border-2 border-yellow-300 rounded-xl p-6">
            <h3 className="font-bold text-yellow-800 text-lg mb-2">⚠️ Aucun prompt</h3>
            <p className="text-yellow-700 text-sm">Utilise l'analyseur de site ou ajoute des prompts manuellement dans le tableau ci-dessus.</p>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold">📸 Bibliothèque Produits</h2>
            <div className="flex gap-2">
              <button onClick={() => setShowNewGroupModal(true)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-semibold">+ Créer un groupe</button>
              {Object.keys(productGroups).length > 0 && (
                <button onClick={clearAllProductGroups} className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm rounded-lg font-semibold">🗑️ Tout effacer</button>
              )}
            </div>
          </div>

          {showNewGroupModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
                <h3 className="text-xl font-bold mb-4">Créer un groupe</h3>
                <input type="text" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="Nom du groupe..." className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg mb-4 focus:border-blue-500 focus:outline-none" onKeyPress={(e) => e.key === 'Enter' && createNewGroup()} />
                <div className="flex gap-2">
                  <button onClick={createNewGroup} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold">Créer</button>
                  <button onClick={() => { setShowNewGroupModal(false); setNewGroupName(''); }} className="flex-1 px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-700 rounded-lg font-semibold">Annuler</button>
                </div>
              </div>
            </div>
          )}

          {Object.keys(productGroups).length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-xl border-2 border-dashed border-gray-300">
              <div className="text-6xl mb-4">📂</div>
              <p className="text-gray-600 font-semibold">Aucun groupe de produit</p>
              <p className="text-sm text-gray-500">Crée un groupe pour uploader des images</p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(productGroups).map(([groupName, images]) => (
                <div 
                  key={groupName} 
                  className={`border-2 rounded-xl p-4 transition-all duration-200 ${
                    dragOverGroup === groupName 
                      ? 'border-blue-500 bg-blue-50 shadow-lg shadow-blue-100 scale-[1.01]' 
                      : 'border-gray-200'
                  }`}
                  onDrop={(e) => handleGroupDrop(groupName, e)}
                  onDragOver={(e) => handleGroupDragOver(groupName, e)}
                  onDragLeave={handleGroupDragLeave}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-bold">📂 {groupName} <span className="text-sm text-gray-500 font-normal">({images.length})</span></h3>
                    <div className="flex gap-2">
                      <label className="cursor-pointer">
                        <input type="file" multiple accept="image/*" onChange={(e) => handleGroupImageUpload(groupName, e)} disabled={uploading} className="hidden" />
                        <span className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg font-semibold inline-block">+ Images</span>
                      </label>
                      <button onClick={() => deleteGroup(groupName)} className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm rounded-lg font-semibold">🗑️</button>
                    </div>
                  </div>
                  {images.length === 0 ? (
                    <div className={`text-center py-8 rounded-lg border-2 border-dashed transition-all ${
                      dragOverGroup === groupName
                        ? 'border-blue-400 bg-blue-50'
                        : 'border-gray-300 bg-gray-50'
                    }`}>
                      <p className="text-gray-500 text-sm">
                        {dragOverGroup === groupName ? '📥 Lâche pour ajouter !' : '📎 Glisse des images ici ou clique "+ Images"'}
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-4 gap-3">
                        {images.map((img, i) => (
                          <div key={i} className="relative group">
                            <img src={img.url} alt={img.name} className="w-full h-24 object-cover rounded-lg shadow-md" />
                            <button onClick={() => deleteGroupImage(groupName, img.name)} className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-60 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all">
                              <span className="bg-red-600 text-white px-3 py-1 rounded text-sm font-semibold">🗑️</span>
                            </button>
                            <p className="text-xs text-gray-600 mt-1 truncate">{img.name}</p>
                          </div>
                        ))}
                      </div>
                      {dragOverGroup === groupName && (
                        <div className="mt-3 text-center py-2 rounded-lg border-2 border-dashed border-blue-400 bg-blue-50 animate-pulse">
                          <p className="text-blue-600 text-sm font-medium">📥 Lâche pour ajouter !</p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold">🎨 Charte Graphique</h2>
            {brandAssets.length > 0 && <button onClick={clearBrandAssets} className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm rounded-lg font-semibold">🗑️ Vider</button>}
          </div>
          <div className="grid grid-cols-3 gap-4 mb-4">
            {['logo', 'palette', 'style'].map((type) => (
              <label key={type} className="block">
                <div className="border-2 border-dashed border-gray-300 hover:border-blue-500 rounded-lg p-4 text-center cursor-pointer transition-all">
                  <input type="file" accept="image/*" multiple={type === 'style'} onChange={(e) => handleBrandAssetUpload(e, type as any)} disabled={uploadingBrand} className="hidden" />
                  <div className="text-3xl mb-2">{type === 'logo' ? '🏷️' : type === 'palette' ? '🎨' : '✨'}</div>
                  <p className="text-sm font-semibold text-gray-700 capitalize">{type}</p>
                </div>
              </label>
            ))}
          </div>
          {brandAssets.length > 0 && (
            <div className="grid grid-cols-4 gap-4">
              {brandAssets.map((asset, i) => (
                <div key={i} className="relative group">
                  <img src={asset.url} alt={asset.name} className="w-full h-24 object-contain bg-gray-50 rounded-lg shadow-md p-2" />
                  <button onClick={() => deleteBrandAsset(asset.name)} className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-60 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all">
                    <span className="bg-red-600 text-white px-3 py-1 rounded text-sm font-semibold">🗑️</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex gap-4 mb-4 flex-wrap">
            <label className="flex items-center gap-2 cursor-pointer select-none bg-gray-50 px-4 py-2 rounded-lg border border-gray-200 hover:border-blue-400 transition-colors">
              <input type="checkbox" checked={includeText} onChange={(e) => setIncludeText(e.target.checked)} className="w-5 h-5 rounded accent-blue-600" />
              <span className="font-medium text-gray-700">✍️ Avec texte</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none bg-gray-50 px-4 py-2 rounded-lg border border-gray-200 hover:border-blue-400 transition-colors">
              <input type="checkbox" checked={includeLogo} onChange={(e) => setIncludeLogo(e.target.checked)} className="w-5 h-5 rounded accent-blue-600" />
              <span className="font-medium text-gray-700">🏷️ Avec logo</span>
            </label>
            <div className="flex items-center gap-2 bg-gray-50 px-4 py-2 rounded-lg border border-gray-200">
              <span className="font-medium text-gray-700">🎬 Moteur vidéo:</span>
              <button
                onClick={() => setVideoEngine('veo')}
                className={`px-3 py-1 rounded-lg text-sm font-semibold transition-all ${videoEngine === 'veo' ? 'bg-blue-600 text-white shadow' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
              >
                Veo 3.1
              </button>
              <button
                onClick={() => setVideoEngine('kling')}
                className={`px-3 py-1 rounded-lg text-sm font-semibold transition-all ${videoEngine === 'kling' ? 'bg-purple-600 text-white shadow' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
              >
                Kling v3
              </button>
            </div>
          </div>
          <div className="flex gap-4 mb-4">
            <button onClick={generateSingle} disabled={isGenerating || stats.remaining === 0} className="flex-1 bg-gradient-to-r from-blue-600 to-blue-700 text-white px-8 py-5 rounded-xl font-bold text-xl hover:from-blue-700 hover:to-blue-800 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed transition-all hover:scale-105 active:scale-95 shadow-lg">
              {isGenerating ? <span className="flex items-center justify-center gap-3"><span className="animate-spin">⏳</span> Génération…</span> : '🎯 Générer'}
            </button>
            <button onClick={toggleAutoMode} disabled={stats.remaining === 0} className={`flex-1 px-8 py-5 rounded-xl font-bold text-xl text-white transition-all hover:scale-105 active:scale-95 shadow-lg ${autoMode ? 'bg-gradient-to-r from-red-600 to-red-700 animate-pulse' : 'bg-gradient-to-r from-green-600 to-green-700'} disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed`}>
              {autoMode ? '⏸️ ARRÊTER' : '🚀 MODE AUTO'}
            </button>
          </div>
          {error && (
            <div className={`mt-4 p-4 rounded-lg font-medium transition-all ${
              error.includes('✅') ? 'bg-green-50 border-2 border-green-200 text-green-700' :
              error.includes('⏳') || error.includes('📡') ? 'bg-yellow-50 border-2 border-yellow-200 text-yellow-700' :
              'bg-orange-50 border-2 border-orange-200 text-orange-700'
            }`}>
              {error}
            </div>
          )}
          {autoMode && !error && <div className="mt-4 p-4 bg-green-50 border-2 border-green-200 rounded-lg text-green-700 font-medium animate-pulse">🤖 Mode auto actif</div>}
          {videoPolling && <div className="mt-4 p-4 bg-blue-50 border-2 border-blue-200 rounded-lg text-blue-700 font-medium animate-pulse">🎬 Vidéo {videoPolling.operation.startsWith('kling:') ? 'Kling' : 'Veo'} en cours de création…</div>}
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-2xl font-bold mb-4">🖼️ Dernier média</h2>
            {currentImage ? (
              <div>
                <div className="relative aspect-square rounded-xl overflow-hidden shadow-lg mb-4 border-4 border-gray-100">
                  {currentImage.startsWith('data:video') ? <video src={currentImage} controls autoPlay loop className="w-full h-full object-cover" /> : <img src={currentImage} alt="Generated" className="w-full h-full object-cover" />}
                </div>
                {currentPrompt && <div className="bg-gray-50 p-4 rounded-lg mb-4"><p className="text-sm text-gray-600">Prompt:</p><p className="text-gray-800 mt-1 text-sm">{currentPrompt}</p></div>}
                <a href={currentImage} download={`meta-ad-${Date.now()}.png`} className="block w-full py-3 bg-gradient-to-r from-green-600 to-green-700 text-white text-center rounded-lg font-bold">📥 Télécharger</a>
              </div>
            ) : (
              <div className="aspect-square rounded-xl bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                <div className="text-center"><div className="text-6xl mb-4">🎨</div><p className="text-gray-400">Aucun média</p></div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-2xl font-bold mb-4">📋 Journal</h2>
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {logs.length === 0 ? <p className="text-gray-400 text-sm text-center py-8">Aucune activité</p> : logs.map((log, i) => <div key={i} className="text-sm font-mono bg-gray-50 p-3 rounded-lg border border-gray-200">{log}</div>)}
            </div>
          </div>
        </div>

        {generatedImages.length > 0 && (
          <div className="bg-white rounded-xl shadow-lg p-6 mt-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold">🖼️ Galerie ({generatedImages.length})</h2>
              <div className="flex gap-2">
                <button onClick={downloadAllImages} className="px-6 py-3 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-lg font-bold shadow-lg">📦 ZIP</button>
                <button onClick={clearGeneratedImages} className="px-6 py-3 bg-red-500 text-white rounded-lg font-bold shadow-lg">🗑️ Vider</button>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-6">
              {generatedImages.map((img, i) => (
                <div key={i} className="bg-gray-50 rounded-lg p-3 hover:shadow-lg transition-all">
                  <div className="relative aspect-square rounded-lg overflow-hidden mb-3 border-2 border-gray-200">
                    {img.mediaType === 'video' ? <video src={img.url} loop muted className="w-full h-full object-cover" onMouseEnter={(e) => (e.target as HTMLVideoElement).play()} onMouseLeave={(e) => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }} /> : <img src={img.url} alt="" className="w-full h-full object-cover" />}
                    {img.mediaType === 'video' && <div className="absolute top-2 right-2 bg-red-600 text-white px-2 py-1 rounded text-xs font-bold">🎬</div>}
                  </div>
                  <p className="text-xs text-gray-600 mb-2 line-clamp-2">{img.prompt}</p>
                  <button onClick={() => downloadSingleImage(img.url, img.prompt, img.timestamp)} className="w-full py-2 bg-green-600 text-white text-sm rounded font-semibold">📥</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8 text-center text-gray-500 text-sm">
          <p>Made with ❤️ by Valentin</p>
          <button onClick={clearAllData} className="mt-4 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs rounded font-semibold">🗑️ Tout réinitialiser</button>
        </div>
      </div>
    </div>
  );
}

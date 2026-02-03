'use client';

import { useState, useEffect } from 'react';
import JSZip from 'jszip';

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

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString('fr-FR');
    setLogs(prev => [`[${timestamp}] ${message}`, ...prev.slice(0, 19)]);
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
        addLog(`🖼️ ${parsed.length} image(s) générée(s) restaurée(s)`);
      } catch (e) {
        console.error('Erreur restauration images générées:', e);
        localStorage.removeItem('generatedImages');
      }
    }
    
    const savedBatchCount = localStorage.getItem('batchCount');
    if (savedBatchCount) {
      setBatchCount(parseInt(savedBatchCount));
    }

    // Restaurer un polling vidéo en cours si la page a été rechargée
    const savedVideoPolling = localStorage.getItem('videoPolling');
    if (savedVideoPolling) {
      try {
        const parsed = JSON.parse(savedVideoPolling);
        setVideoPolling(parsed);
        addLog(`🎬 Polling vidéo repris: ${parsed.operation}`);
      } catch (e) {
        localStorage.removeItem('videoPolling');
      }
    }
  }, []);

  // Polling vidéo en arrière-plan
  useEffect(() => {
    if (!videoPolling) return;

    // Sauvegarder dans localStorage pour survivre à un rechargement
    localStorage.setItem('videoPolling', JSON.stringify(videoPolling));
    addLog(`🎬 Polling vidéo démarré: ${videoPolling.operation.split('/').pop()}`);

    let stopped = false;

    const pollOnce = async () => {
      if (stopped) return;
      try {
        const res = await fetch(`/api/veo-poll?operation=${encodeURIComponent(videoPolling.operation)}`);
        const result = await res.json();
        console.log('📊 veo-poll résultat:', result);

        if (result.success && result.done && result.videoUri) {
          // Vidéo prête !
          addLog('✅ Vidéo générée avec succès !');
          setCurrentImage(result.videoUri);
          setCurrentPrompt(videoPolling.prompt);

          const newImage = {
            url: result.videoUri,
            prompt: videoPolling.prompt,
            timestamp: Date.now(),
            mediaType: 'video'
          };

          setGeneratedImages(prev => {
            const updated = [newImage, ...prev];
            if (updated.length === 20) {
              addLog('🎯 20 images atteintes ! Création du ZIP...');
              createAndDownloadZip(updated, batchCount).then(success => {
                if (success) {
                  setBatchCount(c => c + 1);
                  setGeneratedImages([]);
                  localStorage.removeItem('generatedImages');
                  addLog('✨ Nouveau batch démarré');
                }
              });
            }
            return updated;
          });

          setStats(prev => ({ ...prev, generated: prev.generated + 1 }));
          setVideoPolling(null);
          localStorage.removeItem('videoPolling');

        } else if (result.pending) {
          // Pas encore prêt — reessayer dans 12s
          addLog('⏳ Vidéo encore en cours... (re-poll dans 12s)');
          setTimeout(pollOnce, 12000);
        } else {
          // Erreur définitive
          addLog(`❌ Erreur polling vidéo: ${result.error}`);
          setVideoPolling(null);
          localStorage.removeItem('videoPolling');
        }
      } catch (err: any) {
        addLog(`❌ Erreur fetch veo-poll: ${err.message}`);
        // Réessayer dans 15s en cas d'erreur réseau
        setTimeout(pollOnce, 15000);
      }
    };

    pollOnce();

    return () => { stopped = true; };
  }, [videoPolling]);

  useEffect(() => {
    if (Object.keys(productGroups).length > 0) {
      try {
        localStorage.setItem('productGroups', JSON.stringify(productGroups));
      } catch (e) {
        console.error('Quota localStorage dépassé:', e);
        addLog('⚠️ Limite localStorage atteinte pour les groupes produits');
      }
    }
  }, [productGroups]);

  useEffect(() => {
    if (brandAssets.length > 0) {
      try {
        localStorage.setItem('brandAssets', JSON.stringify(brandAssets));
      } catch (e) {
        console.error('Quota localStorage dépassé:', e);
        addLog('⚠️ Limite localStorage atteinte pour les assets marque');
      }
    }
  }, [brandAssets]);

  useEffect(() => {
    if (generatedImages.length > 0 && generatedImages.length < 20) {
      const saveCompressed = async () => {
        try {
          console.log('💾 Compression et sauvegarde de', generatedImages.length, 'images...');
          const compressed = await Promise.all(
            generatedImages.map(async (img) => ({
              ...img,
              url: img.mediaType === 'video' ? img.url : await compressImage(img.url)
            }))
          );
          localStorage.setItem('generatedImages', JSON.stringify(compressed));
          localStorage.setItem('batchCount', batchCount.toString());
          console.log('✅ Sauvegarde réussie');
        } catch (e) {
          console.error('Erreur sauvegarde:', e);
          addLog('⚠️ Impossible de sauvegarder. Télécharge un ZIP manuel !');
        }
      };
      saveCompressed();
    } else if (generatedImages.length === 0) {
      localStorage.removeItem('generatedImages');
    }
  }, [generatedImages, batchCount]);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    
    if (autoMode && stats.remaining > 0) {
      const generateLoop = async () => {
        await generateSingle();
        intervalId = setTimeout(generateLoop, 5000);
      };
      generateLoop();
    }

    return () => {
      if (intervalId) clearTimeout(intervalId);
    };
  }, [autoMode]);

  async function loadStats() {
    try {
      const response = await fetch('/api/stats');
      const data = await response.json();
      setStats(data);
      addLog(`📊 Stats chargées: ${data.total} prompts au total`);
    } catch (err) {
      addLog('❌ Erreur chargement stats');
    }
  }

  async function generateSingle() {
    if (isGenerating) return;
    
    const totalImages = Object.values(productGroups).reduce((sum, imgs) => sum + imgs.length, 0);
    if (totalImages === 0) {
      setError('⚠️ Upload au moins une image produit dans un groupe !');
      addLog('❌ Aucune image produit disponible');
      return;
    }
    
    setIsGenerating(true);
    setError(null);
    addLog('🎨 Démarrage génération...');
    addLog(`🖼️ ${Object.keys(productGroups).length} groupe(s), ${totalImages} image(s) disponible(s)`);
    if (brandAssets.length > 0) {
      addLog(`🎨 Utilisation de ${brandAssets.length} asset(s) de marque`);
    }
    
    try {
      const maxImages = 10;
      const limitedGroups = Object.fromEntries(
        Object.entries(productGroups).map(([name, images]) => [
          name,
          images.slice(0, Math.ceil(maxImages / Object.keys(productGroups).length))
        ])
      );
      
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          mode: 'single',
          productGroups: limitedGroups,
          brandAssets: brandAssets.map(asset => ({ url: asset.url, type: asset.type }))
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Erreur génération');
      }
      
      if (data.success) {
        // Si vidéo en cours (timeout inline) → lancer polling en arrière-plan
        if (data.videoOperation && !data.imageUrl) {
          addLog(`🎬 Vidéo en cours de génération... polling démarré`);
          setVideoPolling({ operation: data.videoOperation, prompt: data.prompt });
          // Ne pas ajouter à la galerie maintenant — le polling le fera quand c'est prêt
        } else {
          // Image ou vidéo directe — ajouter normalement
          const newImage = {
            url: data.imageUrl,
            prompt: data.prompt,
            timestamp: Date.now(),
            mediaType: data.mediaType || 'image'
          };
          setCurrentImage(data.imageUrl);
          setCurrentPrompt(data.prompt);
          
          setGeneratedImages(prev => {
            const updated = [newImage, ...prev];
            if (updated.length === 20) {
              addLog('🎯 20 images atteintes ! Création du ZIP...');
              createAndDownloadZip(updated, batchCount).then(success => {
                if (success) {
                  setBatchCount(c => c + 1);
                  setGeneratedImages([]);
                  localStorage.removeItem('generatedImages');
                  addLog('✨ Nouveau batch démarré');
                }
              });
            }
            return updated;
          });
          
          setStats(prev => ({
            generated: prev.generated + 1,
            remaining: data.remaining,
            total: prev.total,
          }));
          addLog(`✅ Image générée: "${data.prompt.substring(0, 40)}..."`);
        }
      } else {
        setError(data.message);
        addLog('⚠️ ' + data.message);
        setAutoMode(false);
      }
    } catch (err: any) {
      setError(err.message);
      addLog('❌ ' + err.message);
      setAutoMode(false);
    } finally {
      setIsGenerating(false);
    }
  }

  function toggleAutoMode() {
    if (autoMode) {
      setAutoMode(false);
      addLog('⏸️ Mode auto arrêté manuellement');
    } else {
      setAutoMode(true);
      addLog('🚀 Mode auto démarré');
    }
  }

  function createNewGroup() {
    if (!newGroupName.trim()) {
      alert('⚠️ Donne un nom au groupe !');
      return;
    }
    if (productGroups[newGroupName]) {
      alert('⚠️ Ce nom de groupe existe déjà !');
      return;
    }
    setProductGroups(prev => ({ ...prev, [newGroupName]: [] }));
    addLog(`📁 Groupe "${newGroupName}" créé`);
    setNewGroupName('');
    setShowNewGroupModal(false);
  }

  function handleGroupImageUpload(groupName: string, e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    addLog(`📤 Upload de ${files.length} image(s) dans "${groupName}"...`);
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = event.target?.result as string;
        const compressed = await compressImage(base64);
        setProductGroups(prev => ({
          ...prev,
          [groupName]: [...(prev[groupName] || []), { name: file.name, url: compressed }]
        }));
        addLog(`✅ ${file.name} ajouté à "${groupName}"`);
      };
      reader.readAsDataURL(file);
    });
    setUploading(false);
  }

  function deleteGroupImage(groupName: string, imageName: string) {
    setProductGroups(prev => ({
      ...prev,
      [groupName]: prev[groupName].filter(img => img.name !== imageName)
    }));
    addLog(`🗑️ ${imageName} supprimé de "${groupName}"`);
  }

  function deleteGroup(groupName: string) {
    if (confirm(`⚠️ Supprimer le groupe "${groupName}" et toutes ses images ?`)) {
      setProductGroups(prev => {
        const newGroups = { ...prev };
        delete newGroups[groupName];
        return newGroups;
      });
      addLog(`🗑️ Groupe "${groupName}" supprimé`);
    }
  }

  function clearAllProductGroups() {
    if (confirm('⚠️ Supprimer tous les groupes de produits et leurs images ?')) {
      setProductGroups({});
      localStorage.removeItem('productGroups');
      addLog('🗑️ Tous les groupes effacés');
    }
  }

  function handleBrandAssetUpload(e: React.ChangeEvent<HTMLInputElement>, type: 'logo' | 'palette' | 'style') {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploadingBrand(true);
    const typeLabel = type === 'logo' ? 'Logo' : type === 'palette' ? 'Palette' : 'Exemple';
    addLog(`📤 Upload ${typeLabel}...`);
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        setBrandAssets(prev => [...prev, { name: file.name, url: base64, type }]);
        addLog(`✅ ${typeLabel} ${file.name} uploadé`);
      };
      reader.readAsDataURL(file);
    });
    setUploadingBrand(false);
  }

  function deleteBrandAsset(name: string) {
    setBrandAssets(prev => prev.filter(asset => asset.name !== name));
    addLog(`🗑️ ${name} supprimé`);
  }

  function clearBrandAssets() {
    if (confirm('⚠️ Supprimer tous les assets de marque (logo, palette, exemples) ?')) {
      setBrandAssets([]);
      localStorage.removeItem('brandAssets');
      addLog('🗑️ Assets de marque effacés');
    }
  }

  async function compressImage(base64: string): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        const maxSize = 600;
        let width = img.width;
        let height = img.height;
        if (width > height && width > maxSize) {
          height = (height * maxSize) / width;
          width = maxSize;
        } else if (height > maxSize) {
          width = (width * maxSize) / height;
          height = maxSize;
        }
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL('image/jpeg', 0.5);
        resolve(compressed);
      };
      img.src = base64;
    });
  }

  function downloadSingleImage(mediaUrl: string, prompt: string, timestamp: number) {
    const link = document.createElement('a');
    link.href = mediaUrl;
    const extension = mediaUrl.startsWith('data:video') ? 'mp4' : 'png';
    link.download = `meta-ad-${timestamp}.${extension}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    addLog(`📥 ${extension.toUpperCase()} téléchargé`);
  }

  function downloadAllImages() {
    if (generatedImages.length === 0) {
      addLog('❌ Aucune image à télécharger');
      return;
    }
    addLog(`📦 Création d'un ZIP avec ${generatedImages.length} images...`);
    createAndDownloadZip(generatedImages, batchCount);
  }

  function clearAllData() {
    if (confirm('⚠️ Supprimer tous les groupes produits, assets de marque et la galerie ? Cette action est irréversible.')) {
      setProductGroups({});
      setBrandAssets([]);
      setGeneratedImages([]);
      setCurrentImage(null);
      setCurrentPrompt('');
      setBatchCount(1);
      setVideoPolling(null);
      localStorage.removeItem('productGroups');
      localStorage.removeItem('brandAssets');
      localStorage.removeItem('generatedImages');
      localStorage.removeItem('batchCount');
      localStorage.removeItem('videoPolling');
      addLog('🗑️ Toutes les données effacées');
    }
  }

  function clearGeneratedImages() {
    if (confirm('⚠️ Supprimer toute la galerie d\'images générées ? Les images produits seront conservées.')) {
      setGeneratedImages([]);
      setCurrentImage(null);
      setCurrentPrompt('');
      localStorage.removeItem('generatedImages');
      addLog('🗑️ Galerie effacée');
    }
  }

  async function createAndDownloadZip(images: typeof generatedImages, batchNumber: number) {
    try {
      addLog(`📦 Création du ZIP batch-${batchNumber}...`);
      const zip = new JSZip();
      for (let i = 0; i < images.length; i++) {
        const media = images[i];
        const base64Data = media.url.split(',')[1];
        const isVideo = media.mediaType === 'video' || media.url.startsWith('data:video');
        const extension = isVideo ? 'mp4' : 'png';
        zip.file(`${isVideo ? 'video' : 'image'}-${i + 1}.${extension}`, base64Data, { base64: true });
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(zipBlob);
      link.download = `meta-ads-batch-${batchNumber}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      addLog(`✅ ZIP batch-${batchNumber} téléchargé (${images.length} médias)`);
      return true;
    } catch (error) {
      console.error('Erreur création ZIP:', error);
      addLog(`❌ Erreur création ZIP batch-${batchNumber}`);
      return false;
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-pink-50 p-4">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-8 mt-8">
          <h1 className="text-6xl font-bold mb-3 bg-gradient-to-r from-purple-600 via-blue-600 to-pink-600 bg-clip-text text-transparent">
            🎨 Meta Ads Generator
          </h1>
          <p className="text-gray-600 text-lg">Powered by Google Gemini AI</p>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow-lg p-6 text-center transform hover:scale-105 transition-transform">
            <div className="text-5xl font-bold text-green-600 mb-2">{stats.generated}</div>
            <div className="text-sm text-gray-600 uppercase tracking-wide">✅ Générées</div>
          </div>
          <div className="bg-white rounded-xl shadow-lg p-6 text-center transform hover:scale-105 transition-transform">
            <div className="text-5xl font-bold text-orange-600 mb-2">{stats.remaining}</div>
            <div className="text-sm text-gray-600 uppercase tracking-wide">⏳ En attente</div>
          </div>
          <div className="bg-white rounded-xl shadow-lg p-6 text-center transform hover:scale-105 transition-transform">
            <div className="text-5xl font-bold text-blue-600 mb-2">{stats.total}</div>
            <div className="text-sm text-gray-600 uppercase tracking-wide">📊 Total</div>
          </div>
        </div>

        <div className="mb-6 flex gap-4">
          <button
            onClick={loadStats}
            disabled={isGenerating}
            className="flex-1 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-xl font-semibold transition-all transform hover:scale-105 active:scale-95 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            🔄 Actualiser les prompts depuis le Google Sheet
          </button>
        </div>

        {stats.total === 0 && (
          <div className="mb-6 bg-yellow-50 border-2 border-yellow-300 rounded-xl p-6">
            <div className="flex items-start gap-3">
              <span className="text-3xl">⚠️</span>
              <div>
                <h3 className="font-bold text-yellow-800 text-lg mb-2">Aucun prompt détecté</h3>
                <ol className="text-yellow-700 space-y-1 text-sm list-decimal list-inside">
                  <li>Ajoutez des prompts dans votre Google Sheet (colonne "Prompt")</li>
                  <li>Cliquez sur "🔄 Actualiser les prompts" ci-dessus</li>
                  <li>Vos prompts apparaîtront dans les statistiques</li>
                </ol>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold">📸 Bibliothèque Produits</h2>
            <div className="flex gap-2">
              <button
                onClick={() => setShowNewGroupModal(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-semibold transition-all"
              >
                + Créer un groupe
              </button>
              {Object.keys(productGroups).length > 0 && (
                <button
                  onClick={clearAllProductGroups}
                  className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm rounded-lg font-semibold transition-all"
                >
                  🗑️ Tout effacer
                </button>
              )}
            </div>
          </div>

          {showNewGroupModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
                <h3 className="text-xl font-bold mb-4">Créer un groupe de produit</h3>
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="Ex: Brumes, Bougies, Savons, etc."
                  className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg mb-4 focus:border-blue-500 focus:outline-none"
                  onKeyPress={(e) => e.key === 'Enter' && createNewGroup()}
                />
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
              <p className="text-gray-600 font-semibold mb-2">Aucun groupe de produit</p>
              <p className="text-sm text-gray-500">Crée un groupe pour commencer à uploader des images</p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(productGroups).map(([groupName, images]) => (
                <div key={groupName} className="border-2 border-gray-200 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                      📂 {groupName}
                      <span className="text-sm text-gray-500 font-normal">({images.length} image{images.length > 1 ? 's' : ''})</span>
                    </h3>
                    <div className="flex gap-2">
                      <label className="cursor-pointer">
                        <input type="file" multiple accept="image/*" onChange={(e) => handleGroupImageUpload(groupName, e)} disabled={uploading} className="hidden" />
                        <span className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg font-semibold transition-all inline-block">+ Ajouter images</span>
                      </label>
                      <button onClick={() => deleteGroup(groupName)} className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm rounded-lg font-semibold transition-all">🗑️</button>
                    </div>
                  </div>
                  {images.length === 0 ? (
                    <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                      <p className="text-gray-500 text-sm">Aucune image dans ce groupe</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-4 gap-3">
                      {images.map((img, i) => (
                        <div key={i} className="relative group">
                          <img src={img.url} alt={img.name} className="w-full h-24 object-cover rounded-lg shadow-md" />
                          <button onClick={() => deleteGroupImage(groupName, img.name)} className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-60 transition-all rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100">
                            <span className="bg-red-600 text-white px-3 py-1 rounded text-sm font-semibold">🗑️</span>
                          </button>
                          <p className="text-xs text-gray-600 mt-1 truncate">{img.name}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold">🎨 Charte Graphique (Optionnel)</h2>
            {brandAssets.length > 0 && (
              <button onClick={clearBrandAssets} className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm rounded-lg font-semibold transition-all">🗑️ Vider charte</button>
            )}
          </div>
          <p className="text-sm text-gray-600 mb-4">Upload logo, palette de couleurs et exemples de style pour garantir la cohérence de marque</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <label className="block">
              <div className="border-2 border-dashed border-blue-300 hover:border-blue-500 rounded-lg p-4 text-center cursor-pointer transition-all">
                <input type="file" accept="image/*" onChange={(e) => handleBrandAssetUpload(e, 'logo')} disabled={uploadingBrand} className="hidden" />
                <div className="text-3xl mb-2">🏷️</div>
                <p className="text-sm font-semibold text-gray-700">Logo</p>
                <p className="text-xs text-gray-500 mt-1">PNG transparent</p>
              </div>
            </label>
            <label className="block">
              <div className="border-2 border-dashed border-purple-300 hover:border-purple-500 rounded-lg p-4 text-center cursor-pointer transition-all">
                <input type="file" accept="image/*" onChange={(e) => handleBrandAssetUpload(e, 'palette')} disabled={uploadingBrand} className="hidden" />
                <div className="text-3xl mb-2">🎨</div>
                <p className="text-sm font-semibold text-gray-700">Palette</p>
                <p className="text-xs text-gray-500 mt-1">Couleurs de marque</p>
              </div>
            </label>
            <label className="block">
              <div className="border-2 border-dashed border-green-300 hover:border-green-500 rounded-lg p-4 text-center cursor-pointer transition-all">
                <input type="file" multiple accept="image/*" onChange={(e) => handleBrandAssetUpload(e, 'style')} disabled={uploadingBrand} className="hidden" />
                <div className="text-3xl mb-2">✨</div>
                <p className="text-sm font-semibold text-gray-700">Exemples</p>
                <p className="text-xs text-gray-500 mt-1">Visuels de référence</p>
              </div>
            </label>
          </div>
          {brandAssets.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {brandAssets.map((asset, i) => (
                <div key={i} className="relative group">
                  <img src={asset.url} alt={asset.name} className="w-full h-24 object-contain bg-gray-50 rounded-lg shadow-md p-2" />
                  <div className="absolute top-2 right-2">
                    <span className="bg-white px-2 py-1 rounded text-xs font-semibold shadow">{asset.type === 'logo' ? '🏷️' : asset.type === 'palette' ? '🎨' : '✨'}</span>
                  </div>
                  <button onClick={() => deleteBrandAsset(asset.name)} className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-60 transition-all rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100">
                    <span className="bg-red-600 text-white px-3 py-1 rounded text-sm font-semibold">🗑️ Supprimer</span>
                  </button>
                  <p className="text-xs text-gray-600 mt-1 truncate">{asset.name}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex gap-4 mb-4">
            <button
              onClick={generateSingle}
              disabled={isGenerating || stats.remaining === 0}
              className="flex-1 bg-gradient-to-r from-blue-600 to-blue-700 text-white px-8 py-5 rounded-xl font-bold text-xl hover:from-blue-700 hover:to-blue-800 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed transition-all transform hover:scale-105 active:scale-95 shadow-lg"
            >
              {isGenerating ? (
                <span className="flex items-center justify-center gap-3">
                  <span className="animate-spin">⏳</span> Génération en cours...
                </span>
              ) : (
                '🎯 Générer 1 image'
              )}
            </button>
            <button
              onClick={toggleAutoMode}
              disabled={stats.remaining === 0}
              className={`flex-1 px-8 py-5 rounded-xl font-bold text-xl text-white transition-all transform hover:scale-105 active:scale-95 shadow-lg ${
                autoMode 
                  ? 'bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 animate-pulse' 
                  : 'bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800'
              } disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed`}
            >
              {autoMode ? '⏸️ ARRÊTER AUTO' : '🚀 MODE AUTO'}
            </button>
          </div>

          {error && (
            <div className="mt-4 p-4 bg-red-50 border-2 border-red-200 rounded-lg text-red-700 font-medium">❌ {error}</div>
          )}

          {autoMode && (
            <div className="mt-4 p-4 bg-green-50 border-2 border-green-200 rounded-lg text-green-700 font-medium animate-pulse">
              🤖 Mode automatique actif - Génération toutes les 5 secondes...
            </div>
          )}

          {/* Indicateur polling vidéo en cours */}
          {videoPolling && (
            <div className="mt-4 p-4 bg-blue-50 border-2 border-blue-200 rounded-lg text-blue-700 font-medium animate-pulse flex items-center gap-3">
              <span className="animate-spin text-xl">⏳</span>
              <div>
                <p className="font-bold">🎬 Vidéo en cours de génération...</p>
                <p className="text-sm opacity-75">Polling automatique en arrière-plan — ça peut prendre 1-3 minutes</p>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">🖼️ Dernière image générée</h2>
            {currentImage ? (
              <div>
                <div className="relative aspect-square rounded-xl overflow-hidden shadow-lg mb-4 border-4 border-gray-100">
                  {currentImage.startsWith('data:video') || (currentImage.startsWith('https') && currentImage.includes('.mp4')) ? (
                    <video src={currentImage} controls autoPlay loop className="w-full h-full object-cover" />
                  ) : (
                    <img src={currentImage} alt="Generated" className="w-full h-full object-cover" />
                  )}
                </div>
                {currentPrompt && (
                  <div className="bg-gray-50 p-4 rounded-lg mb-4">
                    <p className="text-sm text-gray-600 font-medium">Prompt utilisé:</p>
                    <p className="text-gray-800 mt-1">{currentPrompt}</p>
                  </div>
                )}
                <a
                  href={currentImage}
                  download={`meta-ad-${Date.now()}.${currentImage.startsWith('data:video') ? 'mp4' : 'png'}`}
                  className="block w-full py-3 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white text-center rounded-lg font-bold transition-all"
                >
                  📥 Télécharger
                </a>
              </div>
            ) : (
              <div className="aspect-square rounded-xl bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-6xl mb-4">🎨</div>
                  <p className="text-gray-400 font-medium">Aucune image générée</p>
                  <p className="text-gray-300 text-sm mt-2">Clique sur Générer 1 image pour commencer</p>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">📋 Journal activité</h2>
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {logs.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-8">Aucune activité pour le moment...</p>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className="text-sm font-mono bg-gray-50 p-3 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors">{log}</div>
                ))
              )}
            </div>
          </div>
        </div>

        {generatedImages.length > 0 && (
          <div className="bg-white rounded-xl shadow-lg p-6 mt-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold flex items-center gap-2">🖼️ Galerie des images générées ({generatedImages.length})</h2>
              <div className="flex gap-2">
                <button onClick={downloadAllImages} className="px-6 py-3 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white rounded-lg font-bold transition-all shadow-lg">📦 Tout télécharger</button>
                <button onClick={clearGeneratedImages} className="px-6 py-3 bg-red-500 hover:bg-red-600 text-white rounded-lg font-bold transition-all shadow-lg">🗑️ Vider galerie</button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {generatedImages.map((img, i) => (
                <div key={i} className="bg-gray-50 rounded-lg p-3 hover:shadow-lg transition-all">
                  <div className="relative aspect-square rounded-lg overflow-hidden mb-3 border-2 border-gray-200">
                    {img.mediaType === 'video' || img.url.startsWith('data:video') || (img.url.startsWith('https') && img.url.includes('.mp4')) ? (
                      <>
                        <video
                          src={img.url}
                          loop
                          muted
                          className="w-full h-full object-cover"
                          onMouseEnter={(e) => (e.target as HTMLVideoElement).play()}
                          onMouseLeave={(e) => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
                        />
                        <div className="absolute top-2 right-2 bg-red-600 text-white px-2 py-1 rounded text-xs font-bold">🎬 VIDEO</div>
                      </>
                    ) : (
                      <img src={img.url} alt={img.prompt} className="w-full h-full object-cover" />
                    )}
                  </div>
                  <p className="text-xs text-gray-600 mb-2 line-clamp-2">{img.prompt}</p>
                  <button onClick={() => downloadSingleImage(img.url, img.prompt, img.timestamp)} className="w-full py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded font-semibold transition-all">📥 Télécharger</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8 text-center text-gray-500 text-sm">
          <p>💡 Astuce: Configure tes prompts dans ton Google Sheet avant de lancer la génération</p>
          <p className="mt-2">Made with love by Valentin</p>
          <button onClick={clearAllData} className="mt-4 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs rounded font-semibold transition-all">🗑️ Tout réinitialiser (bibliothèque + galerie)</button>
        </div>
      </div>
    </div>
  );
}

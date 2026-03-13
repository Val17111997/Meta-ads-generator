'use client';

import { useState } from 'react';
import JSZip from 'jszip';
import ImageEditor from './ImageEditor';

export interface FavoriteItem {
  id: string;
  url: string;
  prompt: string;
  mediaType?: string;
  timestamp: number;
}

interface FavoritesPanelProps {
  favorites: FavoriteItem[];
  loading?: boolean;
  onRemove: (id: string) => void;
  onClearAll: () => void;
  onVariantsGenerated?: () => void;
  onSaveEdited?: (dataUrl: string, originalPrompt: string) => void;
}

export default function FavoritesPanel({ favorites, loading, onRemove, onClearAll, onVariantsGenerated, onSaveEdited }: FavoritesPanelProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [status, setStatus] = useState('');
  const [variantCount, setVariantCount] = useState(10);
  const [contentType, setContentType] = useState<'photo' | 'video' | 'both'>('both');
  const [editingFav, setEditingFav] = useState<FavoriteItem | null>(null);
  const [resizingFav, setResizingFav] = useState<FavoriteItem | null>(null);
  const [resizeFormat, setResizeFormat] = useState('9:16');
  const [resizing, setResizing] = useState(false);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === favorites.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(favorites.map(f => f.id)));
    }
  };

  const downloadSelectedZip = async () => {
    const selected = favorites.filter(f => selectedIds.has(f.id));
    if (selected.length === 0) return;

    setZipping(true);
    setStatus(`📦 Préparation du ZIP (${selected.length} fichiers)...`);

    try {
      const zip = new JSZip();

      for (let i = 0; i < selected.length; i++) {
        const fav = selected[i];
        const isVideo = fav.mediaType === 'video' || fav.url.endsWith('.mp4');
        const ext = isVideo ? 'mp4' : 'png';
        const fileName = `favori-${i + 1}.${ext}`;

        if (fav.url.startsWith('data:')) {
          const base64 = fav.url.split(',')[1];
          zip.file(fileName, base64, { base64: true });
        } else {
          try {
            const resp = await fetch(fav.url);
            const blob = await resp.blob();
            zip.file(fileName, blob);
          } catch (e) {
            console.warn(`⚠️ Impossible de télécharger: ${fav.url}`);
          }
        }

        setStatus(`📦 ${i + 1}/${selected.length} fichiers ajoutés...`);
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `favoris-${selected.length}-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setStatus(`✅ ZIP téléchargé (${selected.length} fichiers)`);
    } catch (error: any) {
      setStatus(`❌ Erreur ZIP: ${error.message}`);
    } finally {
      setZipping(false);
      setTimeout(() => setStatus(''), 4000);
    }
  };

  const downloadAllZip = async () => {
    if (favorites.length === 0) return;
    setZipping(true);
    setStatus(`📦 Préparation du ZIP (${favorites.length} fichiers)...`);
    try {
      const zip = new JSZip();
      for (let i = 0; i < favorites.length; i++) {
        const fav = favorites[i];
        const isVideo = fav.mediaType === 'video' || fav.url.endsWith('.mp4');
        const ext = isVideo ? 'mp4' : 'png';
        const fileName = `favori-${i + 1}.${ext}`;
        if (fav.url.startsWith('data:')) {
          zip.file(fileName, fav.url.split(',')[1], { base64: true });
        } else {
          try { const resp = await fetch(fav.url); zip.file(fileName, await resp.blob()); } catch {}
        }
        setStatus(`📦 ${i + 1}/${favorites.length} fichiers...`);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `favoris-${favorites.length}-${Date.now()}.zip`; document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setStatus(`✅ ZIP téléchargé (${favorites.length} fichiers)`);
    } catch (error: any) { setStatus(`❌ Erreur ZIP: ${error.message}`); }
    finally { setZipping(false); setTimeout(() => setStatus(''), 4000); }
  };

  const generateVariants = async () => {
    const selected = favorites.filter(f => selectedIds.has(f.id));
    if (selected.length === 0) return;

    setGenerating(true);
    setStatus(`✍️ Génération de ${variantCount} variantes à partir de ${selected.length} favori(s)...`);

    try {
      const response = await fetch('/api/analyze-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'variants',
          sourcePrompts: selected.map(f => ({ prompt: f.prompt, type: f.mediaType || 'image' })),
          contentType,
          promptCount: variantCount,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setStatus(`✅ ${data.promptCount} variantes ajoutées en base !`);
        setSelectMode(false);
        setSelectedIds(new Set());
        if (onVariantsGenerated) onVariantsGenerated();
      } else {
        setStatus(`❌ ${data.error || 'Erreur'}`);
      }
    } catch (error: any) {
      setStatus(`❌ ${error.message}`);
    } finally {
      setGenerating(false);
      setTimeout(() => setStatus(''), 5000);
    }
  };

  const adaptFormat = async (fav: FavoriteItem, targetFormat: string) => {
    setResizing(true);
    setStatus(`📐 Adaptation en ${targetFormat}...`);
    try {
      const safeZoneNote = targetFormat === '9:16'
        ? ' CRITICAL: This is for Instagram/TikTok Stories. Keep ALL important content (product, text, key visuals) in the center 60% of the frame. Leave the top 15% and bottom 25% as safe zones with only background — no text, no product, no important elements in these areas.'
        : targetFormat === '16:9'
        ? ' Keep all important content away from the extreme edges of the frame.'
        : '';

      const response = await fetch('/api/generate-resize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceImageUrl: fav.url,
          prompt: fav.prompt,
          targetFormat,
          safeZoneNote,
        }),
      });

      const data = await response.json();
      if (data.success && data.imageUrl) {
        if (onSaveEdited) {
          onSaveEdited(data.imageUrl, fav.prompt + ` (${targetFormat})`);
        }
        setStatus(`✅ Créa adaptée en ${targetFormat} !`);
      } else {
        setStatus(`❌ ${data.error || 'Erreur lors de l\'adaptation'}`);
      }
    } catch (error: any) {
      setStatus(`❌ ${error.message}`);
    } finally {
      setResizing(false);
      setResizingFav(null);
      setTimeout(() => setStatus(''), 5000);
    }
  };

  if (loading) return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mt-6">
      <h2 className="text-2xl font-bold text-gray-300 mb-3">⭐ Favoris</h2>
      <div className="grid grid-cols-5 gap-4">
        {[1,2,3,4,5].map(i => (
          <div key={i} className="aspect-square rounded-lg bg-gray-100 animate-pulse" />
        ))}
      </div>
    </div>
  );

  if (favorites.length === 0) return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mt-6">
      <h2 className="text-2xl font-bold text-gray-300 mb-2">⭐ Favoris</h2>
      <p className="text-sm text-gray-400">Clique sur ⭐ sous une image de la galerie pour l'ajouter à tes favoris. Tu pourras ensuite les exporter en ZIP ou générer des variantes.</p>
    </div>
  );

  const selectedCount = selectedIds.size;

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 mt-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">⭐ Favoris ({favorites.length})</h2>
        <div className="flex gap-2">
          <button
            onClick={downloadAllZip}
            disabled={zipping}
            className="px-4 py-2 bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600 text-white text-sm rounded-lg font-semibold transition-all disabled:opacity-50 disabled:cursor-wait"
          >
            {zipping ? '⏳ ZIP...' : '📦 Télécharger tout'}
          </button>
          <button
            onClick={() => { setSelectMode(!selectMode); if (selectMode) setSelectedIds(new Set()); }}
            className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all ${
              selectMode
                ? 'bg-amber-100 text-amber-700 border-2 border-amber-300'
                : 'bg-amber-500 hover:bg-amber-600 text-white'
            }`}
          >
            {selectMode ? '✕ Annuler' : '✨ Variantes'}
          </button>
          <button onClick={onClearAll} className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-500 text-sm rounded-lg font-semibold border border-red-200">
            🗑️
          </button>
        </div>
      </div>

      {selectMode && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
          <p className="text-sm text-amber-800 mb-3 font-medium">
            Sélectionne les créas qui te plaisent pour générer des variantes inspirées de ces prompts.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={selectAll}
              className="px-3 py-1.5 bg-white border border-amber-300 rounded-lg text-sm font-medium text-amber-700 hover:bg-amber-50"
            >
              {selectedIds.size === favorites.length ? 'Tout désélectionner' : 'Tout sélectionner'}
            </button>
            
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-amber-200">
              <label className="text-sm font-medium text-gray-600">Nb :</label>
              <select
                value={variantCount}
                onChange={(e) => setVariantCount(parseInt(e.target.value))}
                className="bg-transparent text-sm font-semibold text-gray-800 focus:outline-none cursor-pointer"
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={15}>15</option>
                <option value={20}>20</option>
              </select>
            </div>

            <div className="flex items-center gap-1 bg-white px-2 py-1 rounded-lg border border-amber-200">
              {(['photo', 'video', 'both'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setContentType(t)}
                  className={`px-2 py-1 rounded text-xs font-semibold transition-all ${
                    contentType === t
                      ? 'bg-amber-500 text-white'
                      : 'text-gray-500 hover:bg-amber-50'
                  }`}
                >
                  {t === 'photo' ? '📷' : t === 'video' ? '🎬' : '📷🎬'}
                </button>
              ))}
            </div>

            {selectedCount > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={downloadSelectedZip}
                  disabled={zipping}
                  className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-semibold transition-all disabled:opacity-50"
                >
                  {zipping ? '⏳...' : `📦 ZIP (${selectedCount})`}
                </button>
                <button
                  onClick={generateVariants}
                  disabled={generating}
                  className="px-4 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg text-sm font-bold hover:shadow-lg hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-wait"
                >
                  {generating ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                      En cours...
                    </span>
                  ) : `✨ ${variantCount} variantes`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {status && (
        <div className={`p-3 rounded-xl mb-4 text-sm font-medium ${
          status.startsWith('✅') ? 'bg-green-50 text-green-700 border border-green-200' :
          status.startsWith('❌') ? 'bg-red-50 text-red-700 border border-red-200' :
          'bg-blue-50 text-blue-700 border border-blue-200'
        }`}>
          {status}
        </div>
      )}

      <div className="grid grid-cols-5 gap-4">
        {favorites.map((fav) => {
          const isSelected = selectedIds.has(fav.id);
          return (
            <div
              key={fav.id}
              className={`relative rounded-lg overflow-hidden transition-all group ${
                selectMode ? 'cursor-pointer' : ''
              } ${isSelected ? 'ring-4 ring-amber-400 shadow-lg shadow-amber-100 scale-[1.03]' : 'hover:shadow-md'}`}
              onClick={() => selectMode && toggleSelect(fav.id)}
            >
              <div className="relative aspect-square bg-gray-100">
                {fav.mediaType === 'video' ? (
                  <video
                    src={fav.url}
                    loop muted
                    className="w-full h-full object-cover"
                    onMouseEnter={(e) => (e.target as HTMLVideoElement).play()}
                    onMouseLeave={(e) => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
                  />
                ) : (
                  <img src={fav.url} alt="" className="w-full h-full object-cover" />
                )}
                {fav.mediaType === 'video' && (
                  <div className="absolute top-1 right-1 bg-red-600 text-white px-1.5 py-0.5 rounded text-[10px] font-bold">🎬</div>
                )}
                {selectMode && (
                  <div className={`absolute top-1 left-1 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    isSelected ? 'bg-amber-500 text-white' : 'bg-black bg-opacity-40 text-white'
                  }`}>
                    {isSelected ? '✓' : ''}
                  </div>
                )}
                {!selectMode && (
                  <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {fav.mediaType !== 'video' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setResizingFav(fav); }}
                        className="bg-blue-500 hover:bg-blue-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs"
                        title="Adapter le format"
                      >
                        📐
                      </button>
                    )}
                    {fav.mediaType !== 'video' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingFav(fav); }}
                        className="bg-violet-500 hover:bg-violet-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs"
                      >
                        ✏️
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); onRemove(fav.id); }}
                      className="bg-black bg-opacity-50 hover:bg-opacity-80 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
              <div className="p-2 bg-white">
                <p className="text-[11px] text-gray-500 line-clamp-2 leading-tight">{fav.prompt}</p>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-400 mt-3">
        💡 Clique ⭐ dans la galerie pour ajouter des favoris. Survole une image et clique ✏️ pour ajouter du texte.
      </p>

      {/* Image Editor Overlay */}
      {editingFav && (
        <ImageEditor
          imageUrl={editingFav.url}
          onClose={() => setEditingFav(null)}
          onSave={(dataUrl) => {
            if (onSaveEdited) {
              onSaveEdited(dataUrl, editingFav.prompt);
            }
            setEditingFav(null);
          }}
        />
      )}

      {/* Resize Format Modal */}
      {resizingFav && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[70]" onClick={() => setResizingFav(null)}>
          <div className="bg-white rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl border border-gray-200" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-2 text-gray-700">📐 Adapter le format</h3>
            <p className="text-xs text-gray-400 mb-4">La créa sera régénérée dans le nouveau format en respectant les zones mortes.</p>
            
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[
                { value: '1:1', label: 'Carré', icon: '⬜' },
                { value: '9:16', label: 'Story', icon: '📱' },
                { value: '4:5', label: 'Portrait', icon: '📋' },
                { value: '16:9', label: 'Paysage', icon: '🖥️' },
                { value: '2:3', label: '2:3', icon: '📄' },
                { value: '3:2', label: '3:2', icon: '🖼️' },
              ].map(f => (
                <button
                  key={f.value}
                  onClick={() => setResizeFormat(f.value)}
                  className={`p-3 rounded-lg text-center transition-all border-2 ${
                    resizeFormat === f.value
                      ? 'border-violet-500 bg-violet-50 text-violet-700'
                      : 'border-gray-200 bg-gray-50 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  <div className="text-lg mb-1">{f.icon}</div>
                  <div className="text-xs font-semibold">{f.label}</div>
                  <div className="text-[10px] text-gray-400">{f.value}</div>
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => adaptFormat(resizingFav, resizeFormat)}
                disabled={resizing}
                className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-wait"
              >
                {resizing ? '⏳ Génération...' : `Adapter en ${resizeFormat}`}
              </button>
              <button
                onClick={() => setResizingFav(null)}
                className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-sm font-medium"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

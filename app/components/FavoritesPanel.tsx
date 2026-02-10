'use client';

import { useState } from 'react';
import JSZip from 'jszip';

export interface FavoriteItem {
  id: string;
  url: string;
  prompt: string;
  mediaType?: string;
  timestamp: number;
}

interface FavoritesPanelProps {
  favorites: FavoriteItem[];
  onRemove: (id: string) => void;
  onClearAll: () => void;
  onVariantsGenerated?: () => void;
}

export default function FavoritesPanel({ favorites, onRemove, onClearAll, onVariantsGenerated }: FavoritesPanelProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [status, setStatus] = useState('');
  const [variantCount, setVariantCount] = useState(10);
  const [contentType, setContentType] = useState<'photo' | 'video' | 'both'>('both');

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
          // Base64 data URL
          const base64 = fav.url.split(',')[1];
          zip.file(fileName, base64, { base64: true });
        } else {
          // Remote URL (Supabase Storage) — fetch the binary
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

  if (favorites.length === 0) return null;

  const selectedCount = selectedIds.size;

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 mt-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">⭐ Favoris ({favorites.length})</h2>
        <div className="flex gap-2">
          <button
            onClick={() => { setSelectMode(!selectMode); if (selectMode) setSelectedIds(new Set()); }}
            className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all ${
              selectMode
                ? 'bg-amber-100 text-amber-700 border-2 border-amber-300'
                : 'bg-amber-500 hover:bg-amber-600 text-white'
            }`}
          >
            {selectMode ? '✕ Annuler' : '☑️ Sélectionner'}
          </button>
          <button onClick={onClearAll} className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm rounded-lg font-semibold">
            🗑️
          </button>
        </div>
      </div>

      {selectMode && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
          <p className="text-sm text-amber-800 mb-3 font-medium">
            Sélectionne les contenus qui te plaisent. Claude va générer des variantes inspirées de ces prompts.
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
                  className="px-4 py-1.5 bg-gradient-to-r from-violet-500 to-purple-500 text-white rounded-lg text-sm font-bold hover:shadow-lg hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-wait"
                >
                  {zipping ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                      ZIP...
                    </span>
                  ) : `📦 ZIP (${selectedCount})`}
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
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemove(fav.id); }}
                    className="absolute top-1 right-1 bg-black bg-opacity-50 hover:bg-opacity-80 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    ✕
                  </button>
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
        💡 Clique ⭐ dans la galerie pour ajouter des favoris. Ils sont conservés même après le vidage de la galerie.
      </p>
    </div>
  );
}

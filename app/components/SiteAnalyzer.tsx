'use client';

import { useState, useEffect } from 'react';

interface SiteAnalysis {
  brandName: string;
  positioning: string;
  usps: string[];
  values: string[];
  products: string[];
  targetAudience: string;
  tone: string;
  socialProof: string[];
}

interface PromptItem {
  prompt: string;
  angle: string;
  concept: string;
  type: string;
  format: string;
}

interface SiteAnalyzerProps {
  onPromptsGenerated?: () => void;
}

const LS_KEY = 'siteAnalyzerState';

// ── Composant champ texte éditable ──
function EditableField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const save = () => { onChange(draft); setEditing(false); };
  const cancel = () => { setDraft(value); setEditing(false); };

  if (editing) {
    return (
      <div>
        <span className="font-semibold text-gray-700 text-sm">{label}</span>
        <div className="flex gap-1 mt-1">
          <input
            type="text" value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
            className="flex-1 px-2 py-1 border border-purple-300 rounded text-sm focus:outline-none focus:border-purple-500"
            autoFocus
          />
          <button onClick={save} className="px-2 py-1 bg-purple-600 text-white rounded text-xs font-semibold hover:bg-purple-700">✓</button>
          <button onClick={cancel} className="px-2 py-1 bg-gray-200 text-gray-600 rounded text-xs font-semibold hover:bg-gray-300">✕</button>
        </div>
      </div>
    );
  }

  return (
    <div className="group cursor-pointer" onClick={() => { setDraft(value); setEditing(true); }}>
      <span className="font-semibold text-gray-700 text-sm">{label}</span>
      <p className="text-gray-600 text-sm group-hover:text-purple-700 group-hover:bg-purple-50 rounded px-1 -mx-1 transition-colors">
        {value || <span className="italic text-gray-400">Cliquer pour ajouter</span>}
        <span className="opacity-0 group-hover:opacity-100 text-purple-400 ml-1 text-xs transition-opacity">✏️</span>
      </p>
    </div>
  );
}

// ── Composant liste éditable ──
function EditableList({ label, items, onChange }: { label: string; items: string[]; onChange: (items: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [newItem, setNewItem] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const addItem = () => { if (!newItem.trim()) return; onChange([...items, newItem.trim()]); setNewItem(''); setAdding(false); };
  const removeItem = (index: number) => { onChange(items.filter((_, i) => i !== index)); };
  const saveEdit = (index: number) => {
    if (!editDraft.trim()) { removeItem(index); setEditingIndex(null); return; }
    const updated = [...items]; updated[index] = editDraft.trim(); onChange(updated); setEditingIndex(null);
  };

  return (
    <div>
      <span className="font-semibold text-gray-700 text-sm">{label}</span>
      <ul className="text-gray-600 text-sm mt-1 space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-1 group">
            {editingIndex === i ? (
              <div className="flex gap-1 flex-1">
                <input type="text" value={editDraft} onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(i); if (e.key === 'Escape') setEditingIndex(null); }}
                  className="flex-1 px-2 py-0.5 border border-purple-300 rounded text-sm focus:outline-none focus:border-purple-500" autoFocus />
                <button onClick={() => saveEdit(i)} className="px-1.5 py-0.5 bg-purple-600 text-white rounded text-xs hover:bg-purple-700">✓</button>
                <button onClick={() => setEditingIndex(null)} className="px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded text-xs hover:bg-gray-300">✕</button>
              </div>
            ) : (
              <>
                <span className="text-gray-400 select-none">•</span>
                <span className="flex-1 cursor-pointer hover:text-purple-700 hover:bg-purple-50 rounded px-1 -mx-1 transition-colors"
                  onClick={() => { setEditDraft(item); setEditingIndex(i); }}>
                  {item}
                  <span className="opacity-0 group-hover:opacity-100 text-purple-400 ml-1 text-xs transition-opacity">✏️</span>
                </span>
                <button onClick={(e) => { e.stopPropagation(); removeItem(i); }}
                  className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 text-xs px-1 transition-opacity" title="Supprimer">✕</button>
              </>
            )}
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="flex gap-1 mt-1">
          <input type="text" value={newItem} onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addItem(); if (e.key === 'Escape') setAdding(false); }}
            placeholder="Nouvel élément..." className="flex-1 px-2 py-0.5 border border-purple-300 rounded text-sm focus:outline-none focus:border-purple-500" autoFocus />
          <button onClick={addItem} className="px-1.5 py-0.5 bg-purple-600 text-white rounded text-xs hover:bg-purple-700">✓</button>
          <button onClick={() => { setAdding(false); setNewItem(''); }} className="px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded text-xs hover:bg-gray-300">✕</button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="mt-1 text-xs text-purple-500 hover:text-purple-700 font-medium hover:bg-purple-50 rounded px-1 transition-colors">+ Ajouter</button>
      )}
    </div>
  );
}

// ── Composant principal ──
export default function SiteAnalyzer({ onPromptsGenerated }: SiteAnalyzerProps) {
  const [url, setUrl] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<SiteAnalysis | null>(null);
  const [existingCount, setExistingCount] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [generatingType, setGeneratingType] = useState<string>('');
  const [promptCount, setPromptCount] = useState(20);
  const [status, setStatus] = useState('');
  const [lastPrompts, setLastPrompts] = useState<PromptItem[] | null>(null);
  const [showPrompts, setShowPrompts] = useState(false);
  const [generatedCounts, setGeneratedCounts] = useState<{ photo: number; video: number; both: number }>({ photo: 0, video: 0, both: 0 });
  const [generationHistory, setGenerationHistory] = useState<{ type: string; count: number; timestamp: number }[]>([]);
  const [restored, setRestored] = useState(false);

  // ── Restaurer depuis localStorage ──
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        if (data.url) setUrl(data.url);
        if (data.analysis) setAnalysis(data.analysis);
        if (data.existingCount) setExistingCount(data.existingCount);
        if (data.generatedCounts) setGeneratedCounts(data.generatedCounts);
        if (data.generationHistory) setGenerationHistory(data.generationHistory);
        if (data.promptCount) setPromptCount(data.promptCount);
      }
    } catch {}
    setRestored(true);
  }, []);

  // ── Persister dans localStorage ──
  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ url, analysis, existingCount, generatedCounts, generationHistory, promptCount }));
    } catch {}
  }, [url, analysis, existingCount, generatedCounts, generationHistory, promptCount, restored]);

  // ── Helpers pour modifier l'analyse ──
  const updateAnalysis = (field: keyof SiteAnalysis, value: any) => {
    if (!analysis) return;
    setAnalysis({ ...analysis, [field]: value });
  };

  const analyzeSite = async () => {
    if (!url.trim()) { setStatus('❌ Entre une URL'); return; }
    setAnalyzing(true); setAnalysis(null); setLastPrompts(null);
    setGenerationHistory([]); setGeneratedCounts({ photo: 0, video: 0, both: 0 });
    setStatus('🌐 Connexion au site...');
    try {
      setTimeout(() => setStatus('📥 Récupération du contenu...'), 2000);
      setTimeout(() => setStatus('🧠 Claude analyse la marque...'), 5000);
      const response = await fetch('/api/analyze-site', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), action: 'analyze' }),
      });
      const data = await response.json();
      if (data.success && data.analysis) {
        setAnalysis(data.analysis); setExistingCount(data.existingCount || 0); setStatus('');
      } else { setStatus(`❌ ${data.error || 'Erreur lors de l\'analyse'}`); }
    } catch (error: any) { setStatus(`❌ Erreur: ${error.message}`); }
    finally { setAnalyzing(false); }
  };

  const generatePrompts = async (contentType: 'photo' | 'video' | 'both') => {
    if (!analysis) return;
    setGenerating(true); setGeneratingType(contentType); setLastPrompts(null); setShowPrompts(false);
    const typeLabel = contentType === 'photo' ? '📷 images' : contentType === 'video' ? '🎬 vidéos' : '📷🎬 mixtes';
    setStatus(`✍️ Génération de ${promptCount} prompts ${typeLabel}...`);
    try {
      setTimeout(() => setStatus(`🧠 Claude crée les prompts ${typeLabel}...`), 3000);
      setTimeout(() => setStatus('💾 Ajout à la base de données...'), 15000);
      const response = await fetch('/api/analyze-site', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), action: 'generate', analysis, contentType, promptCount }),
      });
      const data = await response.json();
      if (data.success) {
        setLastPrompts(data.prompts);
        setExistingCount(data.totalForBrand || existingCount + (data.promptCount || 0));
        setGeneratedCounts(prev => ({ ...prev, [contentType]: prev[contentType] + (data.promptCount || 0) }));
        setGenerationHistory(prev => [{ type: contentType, count: data.promptCount || 0, timestamp: Date.now() }, ...prev]);
        setStatus(`✅ ${data.promptCount} prompts ${typeLabel} ajoutés !`);
        if (onPromptsGenerated) onPromptsGenerated();
      } else { setStatus(`❌ ${data.error || 'Erreur lors de la génération'}`); }
    } catch (error: any) { setStatus(`❌ Erreur: ${error.message}`); }
    finally { setGenerating(false); setGeneratingType(''); }
  };

  const hasGenerated = (type: 'photo' | 'video' | 'both') => generatedCounts[type] > 0;
  const totalGenerated = generatedCounts.photo + generatedCounts.video + generatedCounts.both;
  const getButtonLabel = (type: 'photo' | 'video' | 'both') => {
    const icon = type === 'photo' ? '📷' : type === 'video' ? '🎬' : '📷🎬';
    const name = type === 'photo' ? 'Images' : type === 'video' ? 'Vidéos' : 'Les deux';
    return hasGenerated(type) ? `${icon} + ${promptCount} ${name}` : `${icon} ${promptCount} ${name}`;
  };
  const typeIcon = (type: string) => type === 'photo' ? '📷' : type === 'video' ? '🎬' : '📷🎬';
  const isLoading = analyzing || generating;

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        🔍 Générateur de Prompts IA
      </h2>

      <div className="flex gap-3 mb-4">
        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.example.com"
          className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-purple-500 focus:outline-none transition-colors"
          disabled={isLoading} onKeyDown={(e) => e.key === 'Enter' && !isLoading && analyzeSite()} />
        <button onClick={analyzeSite} disabled={isLoading || !url.trim()}
          className={`px-6 py-3 rounded-xl font-semibold transition-all ${analyzing ? 'bg-gray-300 text-gray-500 cursor-wait' : 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:shadow-lg hover:scale-105 active:scale-95'} disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100`}>
          {analyzing ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
              Analyse...
            </span>
          ) : analysis ? '🔄 Ré-analyser' : '🔍 Analyser le site'}
        </button>
      </div>

      {status && (
        <div className={`p-4 rounded-xl mb-4 text-sm font-medium ${
          status.startsWith('✅') ? 'bg-green-50 text-green-700 border border-green-200' :
          status.startsWith('❌') ? 'bg-red-50 text-red-700 border border-red-200' :
          'bg-blue-50 text-blue-700 border border-blue-200'}`}>
          {status}
        </div>
      )}

      {/* ── Résultat de l'analyse (ÉDITABLE) ── */}
      {analysis && (
        <div className="space-y-4">
          <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl p-5 border border-purple-100">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-lg text-purple-800 flex items-center gap-2">
                📊
                <span className="cursor-pointer hover:bg-purple-100 rounded px-1 transition-colors"
                  contentEditable suppressContentEditableWarning
                  onBlur={(e) => updateAnalysis('brandName', e.currentTarget.textContent || '')}>
                  {analysis.brandName}
                </span>
              </h3>
              <span className="text-xs text-purple-400 font-medium">Clique sur un champ pour le modifier</span>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
              <EditableField label="Positionnement :" value={analysis.positioning} onChange={(v) => updateAnalysis('positioning', v)} />
              <EditableField label="Cible :" value={analysis.targetAudience} onChange={(v) => updateAnalysis('targetAudience', v)} />
              <EditableField label="Ton :" value={analysis.tone} onChange={(v) => updateAnalysis('tone', v)} />
              <EditableList label="USPs :" items={analysis.usps} onChange={(items) => updateAnalysis('usps', items)} />
              <EditableList label="Produits :" items={analysis.products} onChange={(items) => updateAnalysis('products', items)} />
              <EditableList label="Valeurs :" items={analysis.values} onChange={(items) => updateAnalysis('values', items)} />
            </div>

            {existingCount > 0 && (
              <div className="mt-3 text-xs text-purple-600 font-medium">📋 {existingCount} prompts déjà en base pour cette marque</div>
            )}
          </div>

          <div className="bg-gray-50 rounded-xl p-5 border border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-gray-800">
                {totalGenerated > 0 ? `✨ Ajouter des prompts (${existingCount} en base)` : '✨ Générer des prompts'}
              </h3>
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-gray-200">
                <label className="text-sm font-medium text-gray-600">Nb :</label>
                <select value={promptCount} onChange={(e) => setPromptCount(parseInt(e.target.value))} disabled={generating}
                  className="bg-transparent text-sm font-semibold text-gray-800 focus:outline-none cursor-pointer">
                  <option value={10}>10</option><option value={15}>15</option><option value={20}>20</option><option value={30}>30</option>
                </select>
              </div>
            </div>
            {totalGenerated === 0 && <p className="text-sm text-gray-500 mb-3">Choisis le type de contenu. Les prompts seront basés sur l'analyse ci-dessus.</p>}
            <div className="grid grid-cols-3 gap-3">
              {(['photo', 'video', 'both'] as const).map((type) => {
                const isActive = generating && generatingType === type;
                const colors = type === 'photo' ? { active: 'bg-blue-100 text-blue-500', normal: 'bg-gradient-to-r from-blue-500 to-blue-600' }
                  : type === 'video' ? { active: 'bg-red-100 text-red-500', normal: 'bg-gradient-to-r from-red-500 to-red-600' }
                  : { active: 'bg-purple-100 text-purple-500', normal: 'bg-gradient-to-r from-purple-600 to-indigo-600' };
                return (
                  <button key={type} onClick={() => generatePrompts(type)} disabled={generating}
                    className={`px-4 py-3.5 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 text-sm ${
                      isActive ? `${colors.active} cursor-wait` : generating ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : `${colors.normal} text-white hover:shadow-lg hover:scale-105 active:scale-95`}`}>
                    {isActive ? (
                      <span className="flex items-center gap-2">
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                        En cours...
                      </span>
                    ) : getButtonLabel(type)}
                  </button>
                );
              })}
            </div>
            {generationHistory.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-gray-200">
                <span className="text-xs text-gray-500 font-medium self-center">Historique :</span>
                {generationHistory.map((gen, i) => (
                  <span key={i} className="px-3 py-1 bg-white text-gray-600 rounded-full text-xs font-medium border border-gray-200">
                    {typeIcon(gen.type)} ×{gen.count} — {new Date(gen.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                ))}
              </div>
            )}
          </div>

          {lastPrompts && lastPrompts.length > 0 && (
            <div>
              <button onClick={() => setShowPrompts(!showPrompts)} className="w-full py-3 bg-gray-100 hover:bg-gray-200 rounded-xl font-medium transition-colors">
                {showPrompts ? '🔼 Masquer les prompts' : `🔽 Voir les ${lastPrompts.length} derniers prompts générés`}
              </button>
              {showPrompts && (
                <div className="max-h-96 overflow-y-auto space-y-3 border rounded-xl p-4 mt-3">
                  {lastPrompts.map((p, i) => (
                    <div key={i} className="bg-gray-50 rounded-lg p-3 text-sm">
                      <div className="flex gap-2 mb-2">
                        <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">{p.angle}</span>
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">{p.concept}</span>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${p.type === 'video' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{p.type} • {p.format}</span>
                      </div>
                      <p className="text-gray-700">{p.prompt}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 text-xs text-gray-500">
        {!analysis ? '💡 Analyse le site d\'abord, puis choisis le type de prompts à générer.'
          : totalGenerated > 0 ? '💡 Modifie l\'analyse si besoin, puis clique à nouveau pour ajouter des prompts avec les infos mises à jour.'
          : '💡 Tu peux modifier les champs de l\'analyse avant de générer. Clique sur un texte pour l\'éditer.'}
      </div>
    </div>
  );
}

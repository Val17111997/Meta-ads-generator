'use client';

import { useState, useEffect, forwardRef, useImperativeHandle, useCallback, useRef } from 'react';

async function safeFetch(url: string, options?: RequestInit): Promise<{ ok: boolean; data: any }> {
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    let data: any = {};
    try { data = JSON.parse(text); } catch { data = { error: 'Réponse inattendue du serveur' }; }
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: { error: 'Connexion au serveur impossible' } };
  }
}

interface Prompt {
  id: string;
  brand: string;
  prompt: string;
  format: string;
  type: string;
  angle: string | null;
  concept: string | null;
  status: string;
  image_url: string | null;
  product_group: string | null;
  created_at: string;
}

export interface PromptsTableRef { reload: () => void; }
interface PromptsTableProps { productGroups?: string[]; }
type FillableColumn = 'format' | 'type' | 'product_group';

const PromptsTable = forwardRef<PromptsTableRef, PromptsTableProps>(({ productGroups = [] }, ref) => {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Partial<Prompt>>({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [newPrompt, setNewPrompt] = useState({ prompt: '', format: '9:16', type: 'photo', angle: '', concept: '', product_group: '' });
  const [stats, setStats] = useState({ total: 0, pending: 0, generated: 0 });
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState('');
  const [importFormat, setImportFormat] = useState('9:16');
  const [importType, setImportType] = useState('photo');
  const [importProductGroup, setImportProductGroup] = useState('');
  const [importing, setImporting] = useState(false);

  // ── Fill-down state ──
  const [fillDrag, setFillDrag] = useState<{ column: FillableColumn; sourceRow: number; sourceValue: string; currentRow: number } | null>(null);
  const [fillSaving, setFillSaving] = useState(false);
  const tableRef = useRef<HTMLTableElement>(null);

  useImperativeHandle(ref, () => ({ reload: () => { loadPrompts(); loadStats(); } }));

  async function loadPrompts() {
    setLoading(true);
    let url = '/api/prompts?limit=500';
    if (statusFilter) url += '&status=' + statusFilter;
    const { ok, data } = await safeFetch(url);
    if (ok && data.success) setPrompts(data.prompts || []);
    setLoading(false);
  }

  async function loadStats() {
    const { ok, data } = await safeFetch('/api/stats');
    if (ok) setStats({ total: data.total || 0, pending: data.remaining || 0, generated: data.generated || 0 });
  }

  useEffect(() => { loadStats(); loadPrompts(); }, [statusFilter]);

  // ── Fill-down handlers ──
  const handleFillMouseMove = useCallback((e: MouseEvent) => {
    if (!fillDrag || !tableRef.current) return;
    const rows = tableRef.current.querySelectorAll('tbody tr');
    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i].getBoundingClientRect();
      if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
        if (i !== fillDrag.currentRow && i >= fillDrag.sourceRow) {
          setFillDrag(prev => prev ? { ...prev, currentRow: i } : null);
        }
        break;
      }
    }
  }, [fillDrag]);

  const handleFillMouseUp = useCallback(async () => {
    if (!fillDrag) return;
    const { column, sourceRow, sourceValue, currentRow } = fillDrag;
    setFillDrag(null);
    if (currentRow <= sourceRow) return;

    const promptsToUpdate = prompts.slice(sourceRow + 1, currentRow + 1);
    if (promptsToUpdate.length === 0) return;

    setFillSaving(true);
    setPrompts(prev => {
      const updated = [...prev];
      for (let i = sourceRow + 1; i <= currentRow && i < updated.length; i++) {
        updated[i] = { ...updated[i], [column]: sourceValue || null };
      }
      return updated;
    });

    let successCount = 0;
    for (const p of promptsToUpdate) {
      const { ok } = await safeFetch('/api/prompts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, [column]: sourceValue || null }),
      });
      if (ok) successCount++;
    }
    setFillSaving(false);
    if (successCount < promptsToUpdate.length) loadPrompts();
  }, [fillDrag, prompts]);

  useEffect(() => {
    if (fillDrag) {
      window.addEventListener('mousemove', handleFillMouseMove);
      window.addEventListener('mouseup', handleFillMouseUp);
      document.body.style.userSelect = 'none';
      return () => {
        window.removeEventListener('mousemove', handleFillMouseMove);
        window.removeEventListener('mouseup', handleFillMouseUp);
        document.body.style.userSelect = '';
      };
    }
  }, [fillDrag, handleFillMouseMove, handleFillMouseUp]);

  function startFillDrag(rowIndex: number, column: FillableColumn, value: string) {
    setFillDrag({ column, sourceRow: rowIndex, sourceValue: value, currentRow: rowIndex });
  }

  function isFillHighlighted(rowIndex: number, column: FillableColumn): boolean {
    if (!fillDrag) return false;
    return fillDrag.column === column && rowIndex > fillDrag.sourceRow && rowIndex <= fillDrag.currentRow;
  }

  function isFillSource(rowIndex: number, column: FillableColumn): boolean {
    if (!fillDrag) return false;
    return fillDrag.column === column && rowIndex === fillDrag.sourceRow;
  }

  async function inlineUpdate(id: string, field: string, value: string) {
    setPrompts(prev => prev.map(p => p.id === id ? { ...p, [field]: value || null } : p));
    await safeFetch('/api/prompts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, [field]: value || null }),
    });
  }

  function startEdit(prompt: Prompt) {
    setEditingId(prompt.id);
    setEditValues({ prompt: prompt.prompt, format: prompt.format, type: prompt.type, angle: prompt.angle || '', concept: prompt.concept || '', status: prompt.status, product_group: prompt.product_group || '' });
  }

  async function saveEdit(id: string) {
    const { ok } = await safeFetch('/api/prompts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...editValues }) });
    if (ok) { setEditingId(null); loadPrompts(); }
  }

  function cancelEdit() { setEditingId(null); setEditValues({}); }

  async function deletePrompt(id: string) {
    if (!confirm('Supprimer ce prompt ?')) return;
    const { ok } = await safeFetch('/api/prompts?id=' + id, { method: 'DELETE' });
    if (ok) { loadPrompts(); loadStats(); }
  }

  async function addPrompt() {
    if (!newPrompt.prompt) { alert('Le prompt est requis !'); return; }
    const brandName = prompts.length > 0 ? prompts[0].brand : 'Ma Marque';
    const { ok } = await safeFetch('/api/prompts/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newPrompt, brand: brandName }) });
    if (ok) { setShowAddModal(false); setNewPrompt({ prompt: '', format: '9:16', type: 'photo', angle: '', concept: '', product_group: '' }); loadPrompts(); loadStats(); }
  }

  async function deleteAll() {
    if (!confirm('Supprimer TOUS les prompts ? Cette action est irréversible !')) return;
    for (const p of prompts) { await safeFetch('/api/prompts?id=' + p.id, { method: 'DELETE' }); }
    loadPrompts(); loadStats();
  }

  async function importPrompts() {
    if (!importText.trim()) { alert('Colle au moins un prompt !'); return; }
    setImporting(true);
    const brandName = prompts.length > 0 ? prompts[0].brand : 'Ma Marque';
    const lines = importText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    let successCount = 0, errorCount = 0;
    for (const line of lines) {
      const { ok } = await safeFetch('/api/prompts/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: line, format: importFormat, type: importType, product_group: importProductGroup || null, brand: brandName, angle: '', concept: '' }) });
      if (ok) successCount++; else errorCount++;
    }
    setImporting(false); setShowImportModal(false); setImportText('');
    alert(`✅ ${successCount} prompt(s) importé(s)${errorCount > 0 ? `\n⚠️ ${errorCount} erreur(s)` : ''}`);
    loadPrompts(); loadStats();
  }

  function renderFillCell(rowIndex: number, column: FillableColumn, currentValue: string, children: React.ReactNode) {
    const isSource = isFillSource(rowIndex, column);
    const isHighlighted = isFillHighlighted(rowIndex, column);
    return (
      <td className={`px-4 py-3 relative select-none ${isHighlighted ? 'bg-blue-100' : ''} ${isSource ? 'bg-blue-50' : ''}`}>
        <div className="relative group/cell">
          {isHighlighted ? (
            <span className="text-sm text-blue-600 font-medium">{fillDrag?.sourceValue || currentValue}</span>
          ) : children}
          {!fillDrag && !editingId && (
            <div
              className="absolute -bottom-1 -right-1 w-3 h-3 bg-blue-600 border-2 border-white rounded-sm cursor-crosshair opacity-0 group-hover/cell:opacity-100 transition-opacity z-10"
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); startFillDrag(rowIndex, column, currentValue); }}
              title="Glisser pour remplir"
            />
          )}
        </div>
      </td>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">📋 Tableau des Prompts</h2>
        <div className="flex gap-2">
          <button onClick={() => setShowImportModal(true)} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold transition-all">📋 Import en masse</button>
          <button onClick={() => setShowAddModal(true)} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition-all">➕ Ajouter</button>
          <button onClick={() => { loadPrompts(); loadStats(); }} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-all">🔄 Rafraîchir</button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-blue-50 rounded-lg p-4 text-center"><div className="text-3xl font-bold text-blue-600">{stats.total}</div><div className="text-sm text-gray-600">Total</div></div>
        <div className="bg-orange-50 rounded-lg p-4 text-center"><div className="text-3xl font-bold text-orange-600">{stats.pending}</div><div className="text-sm text-gray-600">En attente</div></div>
        <div className="bg-green-50 rounded-lg p-4 text-center"><div className="text-3xl font-bold text-green-600">{stats.generated}</div><div className="text-sm text-gray-600">Générés</div></div>
      </div>

      {fillSaving && <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm font-medium animate-pulse">💾 Sauvegarde en cours...</div>}

      <div className="flex gap-4 mb-6">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">Filtrer par statut</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
            <option value="">Tous</option>
            <option value="pending">En attente</option>
            <option value="generating">En cours</option>
            <option value="generated">Généré</option>
            <option value="error">Erreur</option>
          </select>
        </div>
        {prompts.length > 0 && <div className="flex items-end"><button onClick={deleteAll} className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-semibold transition-all">🗑️ Tout supprimer</button></div>}
      </div>

      {prompts.length > 0 && !loading && (
        <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-600 text-xs">
          💡 <strong>Astuce :</strong> Survole une cellule Format, Type ou Produit puis glisse le carré bleu <span className="inline-block w-2.5 h-2.5 bg-blue-600 rounded-sm align-middle mx-0.5"></span> vers le bas pour remplir plusieurs lignes d'un coup.
        </div>
      )}

      {loading ? (
        <div className="text-center py-12"><div className="animate-spin text-4xl mb-4">⏳</div><p className="text-gray-500">Chargement...</p></div>
      ) : prompts.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-xl"><div className="text-6xl mb-4">📭</div><p className="text-gray-600 font-medium">Aucun prompt trouvé</p><p className="text-gray-400 text-sm mt-2">Utilise l'analyseur de site ci-dessus pour générer des prompts</p></div>
      ) : (
        <div className="overflow-x-auto">
          <table ref={tableRef} className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Prompt</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Produit</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Format</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Type</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Statut</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {prompts.map((prompt, rowIndex) => (
                <tr key={prompt.id} className={`border-b hover:bg-gray-50 ${fillDrag ? 'cursor-crosshair' : ''}`}>
                  {editingId === prompt.id ? (
                    <>
                      <td className="px-4 py-3"><textarea value={editValues.prompt || ''} onChange={(e) => setEditValues(prev => ({ ...prev, prompt: e.target.value }))} className="w-full px-2 py-1 border rounded text-sm" rows={3} /></td>
                      <td className="px-4 py-3"><select value={editValues.product_group || ''} onChange={(e) => setEditValues(prev => ({ ...prev, product_group: e.target.value }))} className="px-2 py-1 border rounded text-sm w-full"><option value="">-- Aucun --</option>{productGroups.map(g => <option key={g} value={g}>{g}</option>)}</select></td>
                      <td className="px-4 py-3"><select value={editValues.format || '9:16'} onChange={(e) => setEditValues(prev => ({ ...prev, format: e.target.value }))} className="px-2 py-1 border rounded text-sm"><option value="9:16">9:16</option><option value="1:1">1:1</option><option value="16:9">16:9</option></select></td>
                      <td className="px-4 py-3"><select value={editValues.type || 'photo'} onChange={(e) => setEditValues(prev => ({ ...prev, type: e.target.value }))} className="px-2 py-1 border rounded text-sm"><option value="photo">Photo</option><option value="video">Vidéo</option></select></td>
                      <td className="px-4 py-3"><select value={editValues.status || 'pending'} onChange={(e) => setEditValues(prev => ({ ...prev, status: e.target.value }))} className="px-2 py-1 border rounded text-sm"><option value="pending">En attente</option><option value="generated">Généré</option></select></td>
                      <td className="px-4 py-3"><div className="flex gap-1"><button onClick={() => saveEdit(prompt.id)} className="px-2 py-1 bg-green-600 text-white rounded text-xs font-semibold">✓</button><button onClick={cancelEdit} className="px-2 py-1 bg-gray-400 text-white rounded text-xs font-semibold">✕</button></div></td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 max-w-md">
                        <p className="text-sm text-gray-700 line-clamp-2">{prompt.prompt}</p>
                        {prompt.angle && <span className="inline-block mt-1 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">{prompt.angle}</span>}
                      </td>

                      {renderFillCell(rowIndex, 'product_group', prompt.product_group || '', (
                        <select value={prompt.product_group || ''} onChange={(e) => inlineUpdate(prompt.id, 'product_group', e.target.value)} className="px-2 py-1 border border-transparent hover:border-gray-300 rounded text-sm bg-transparent cursor-pointer focus:border-blue-500 focus:ring-1 focus:ring-blue-500 w-full">
                          <option value="">Non défini</option>
                          {productGroups.map(g => <option key={g} value={g}>{g}</option>)}
                        </select>
                      ))}

                      {renderFillCell(rowIndex, 'format', prompt.format, (
                        <select value={prompt.format} onChange={(e) => inlineUpdate(prompt.id, 'format', e.target.value)} className="px-2 py-1 border border-transparent hover:border-gray-300 rounded text-sm bg-transparent cursor-pointer focus:border-blue-500 focus:ring-1 focus:ring-blue-500">
                          <option value="9:16">9:16</option>
                          <option value="1:1">1:1</option>
                          <option value="16:9">16:9</option>
                        </select>
                      ))}

                      {renderFillCell(rowIndex, 'type', prompt.type, (
                        <select value={prompt.type} onChange={(e) => inlineUpdate(prompt.id, 'type', e.target.value)} className="px-2 py-1 border border-transparent hover:border-gray-300 rounded text-sm bg-transparent cursor-pointer focus:border-blue-500 focus:ring-1 focus:ring-blue-500">
                          <option value="photo">📷 photo</option>
                          <option value="video">🎬 video</option>
                        </select>
                      ))}

                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${prompt.status === 'pending' ? 'bg-orange-100 text-orange-700' : prompt.status === 'generating' ? 'bg-blue-100 text-blue-700' : prompt.status === 'generated' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {prompt.status === 'pending' ? '⏳ En attente' : prompt.status === 'generating' ? '🔄 En cours' : prompt.status === 'generated' ? '✅ Généré' : '❌ Erreur'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button onClick={() => startEdit(prompt)} className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold" title="Modifier">✏️</button>
                          <button onClick={() => deletePrompt(prompt.id)} className="px-2 py-1 bg-red-500 hover:bg-red-600 text-white rounded text-xs font-semibold" title="Supprimer">🗑️</button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {fillDrag && fillDrag.currentRow > fillDrag.sourceRow && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-4 py-2 rounded-full shadow-lg text-sm font-medium z-50 animate-pulse">
          📋 {fillDrag.currentRow - fillDrag.sourceRow} ligne(s) → {fillDrag.column === 'format' ? 'Format' : fillDrag.column === 'type' ? 'Type' : 'Produit'}: {fillDrag.sourceValue || 'Aucun'}
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4">➕ Ajouter un prompt</h3>
            <div className="space-y-4">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Prompt *</label><textarea value={newPrompt.prompt} onChange={(e) => setNewPrompt(prev => ({ ...prev, prompt: e.target.value }))} placeholder="Description visuelle détaillée en anglais..." rows={4} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Groupe de produits</label><select value={newPrompt.product_group} onChange={(e) => setNewPrompt(prev => ({ ...prev, product_group: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg"><option value="">-- Sélectionner --</option>{productGroups.map(g => <option key={g} value={g}>{g}</option>)}</select></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Format</label><select value={newPrompt.format} onChange={(e) => setNewPrompt(prev => ({ ...prev, format: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg"><option value="9:16">9:16</option><option value="1:1">1:1</option><option value="16:9">16:9</option></select></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Type</label><select value={newPrompt.type} onChange={(e) => setNewPrompt(prev => ({ ...prev, type: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg"><option value="photo">📷 Photo</option><option value="video">🎬 Vidéo</option></select></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Angle marketing</label><input type="text" value={newPrompt.angle} onChange={(e) => setNewPrompt(prev => ({ ...prev, angle: e.target.value }))} placeholder="Ex: Social proof..." className="w-full px-3 py-2 border border-gray-300 rounded-lg" /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Concept créatif</label><input type="text" value={newPrompt.concept} onChange={(e) => setNewPrompt(prev => ({ ...prev, concept: e.target.value }))} placeholder="Ex: UGC, Flat lay..." className="w-full px-3 py-2 border border-gray-300 rounded-lg" /></div>
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button onClick={addPrompt} className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold">✅ Ajouter</button>
              <button onClick={() => setShowAddModal(false)} className="flex-1 px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-700 rounded-lg font-semibold">Annuler</button>
            </div>
          </div>
        </div>
      )}

      {showImportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4">📋 Import en masse</h3>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4"><p className="text-blue-800 text-sm"><strong>💡 Astuce :</strong> Colle tes prompts depuis Excel, Google Sheets ou un fichier texte.<br />Un prompt par ligne.</p></div>
            <div className="space-y-4">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Prompts (un par ligne) *</label><textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={`Close-up shot of hands holding the product...\nLifestyle scene showing someone using the product...`} rows={10} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 font-mono text-sm" /><p className="text-xs text-gray-500 mt-1">{importText.split('\n').filter(l => l.trim()).length} prompt(s) détecté(s)</p></div>
              <div className="grid grid-cols-3 gap-4">
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Format</label><select value={importFormat} onChange={(e) => setImportFormat(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg"><option value="9:16">9:16</option><option value="1:1">1:1</option><option value="16:9">16:9</option></select></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Type</label><select value={importType} onChange={(e) => setImportType(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg"><option value="photo">📷 Photo</option><option value="video">🎬 Vidéo</option></select></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Groupe produit</label><select value={importProductGroup} onChange={(e) => setImportProductGroup(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg"><option value="">-- Aucun --</option>{productGroups.map(g => <option key={g} value={g}>{g}</option>)}</select></div>
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button onClick={importPrompts} disabled={importing || !importText.trim()} className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white rounded-lg font-semibold">{importing ? '⏳ Import en cours...' : `📋 Importer ${importText.split('\n').filter(l => l.trim()).length} prompt(s)`}</button>
              <button onClick={() => { setShowImportModal(false); setImportText(''); }} className="flex-1 px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-700 rounded-lg font-semibold">Annuler</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

PromptsTable.displayName = 'PromptsTable';
export default PromptsTable;

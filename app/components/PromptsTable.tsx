'use client';

import { useState, useEffect, useImperativeHandle, forwardRef } from 'react';

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
  created_at: string;
}

export interface PromptsTableRef {
  reload: () => void;
}

const PromptsTable = forwardRef<PromptsTableRef>((props, ref) => {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Partial<Prompt>>({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [newPrompt, setNewPrompt] = useState({
    prompt: '',
    format: '9:16',
    type: 'photo',
    angle: '',
    concept: '',
  });
  const [stats, setStats] = useState({ total: 0, pending: 0, generated: 0 });

  // Exposer la méthode reload au parent
  useImperativeHandle(ref, () => ({
    reload: () => {
      loadPrompts();
      loadStats();
    }
  }));

  async function loadPrompts() {
    setLoading(true);
    try {
      let url = '/api/prompts?limit=500';
      if (statusFilter) url += '&status=' + statusFilter;
      
      const res = await fetch(url);
      const data = await res.json();
      
      if (data.success) {
        setPrompts(data.prompts || []);
      }
    } catch (err) {
      console.error('Erreur chargement prompts:', err);
    }
    setLoading(false);
  }

  async function loadStats() {
    try {
      const res = await fetch('/api/stats');
      const data = await res.json();
      setStats({
        total: data.total || 0,
        pending: data.remaining || 0,
        generated: data.generated || 0,
      });
    } catch (err) {
      console.error('Erreur chargement stats:', err);
    }
  }

  useEffect(() => {
    loadStats();
    loadPrompts();
  }, [statusFilter]);

  function startEdit(prompt: Prompt) {
    setEditingId(prompt.id);
    setEditValues({
      prompt: prompt.prompt,
      format: prompt.format,
      type: prompt.type,
      angle: prompt.angle || '',
      concept: prompt.concept || '',
      status: prompt.status,
    });
  }

  async function saveEdit(id: string) {
    try {
      const res = await fetch('/api/prompts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...editValues }),
      });
      
      if (res.ok) {
        setEditingId(null);
        loadPrompts();
      }
    } catch (err) {
      console.error('Erreur sauvegarde:', err);
    }
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValues({});
  }

  async function deletePrompt(id: string) {
    if (!confirm('Supprimer ce prompt ?')) return;
    
    try {
      const res = await fetch('/api/prompts?id=' + id, { method: 'DELETE' });
      if (res.ok) {
        loadPrompts();
        loadStats();
      }
    } catch (err) {
      console.error('Erreur suppression:', err);
    }
  }

  async function addPrompt() {
    if (!newPrompt.prompt) {
      alert('Le prompt est requis !');
      return;
    }
    
    // Récupérer le nom de la marque depuis le premier prompt existant ou utiliser un défaut
    const brandName = prompts.length > 0 ? prompts[0].brand : 'Ma Marque';
    
    try {
      const res = await fetch('/api/prompts/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newPrompt, brand: brandName }),
      });
      
      if (res.ok) {
        setShowAddModal(false);
        setNewPrompt({ prompt: '', format: '9:16', type: 'photo', angle: '', concept: '' });
        loadPrompts();
        loadStats();
      }
    } catch (err) {
      console.error('Erreur ajout:', err);
    }
  }

  async function deleteAll() {
    if (!confirm('Supprimer TOUS les prompts ? Cette action est irréversible !')) return;
    
    // Supprimer tous les prompts un par un (pas idéal mais simple)
    for (const p of prompts) {
      await fetch('/api/prompts?id=' + p.id, { method: 'DELETE' });
    }
    loadPrompts();
    loadStats();
  }

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">📋 Tableau des Prompts</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition-all"
          >
            ➕ Ajouter
          </button>
          <button
            onClick={() => { loadPrompts(); loadStats(); }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-all"
          >
            🔄 Rafraîchir
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-blue-50 rounded-lg p-4 text-center">
          <div className="text-3xl font-bold text-blue-600">{stats.total}</div>
          <div className="text-sm text-gray-600">Total</div>
        </div>
        <div className="bg-orange-50 rounded-lg p-4 text-center">
          <div className="text-3xl font-bold text-orange-600">{stats.pending}</div>
          <div className="text-sm text-gray-600">En attente</div>
        </div>
        <div className="bg-green-50 rounded-lg p-4 text-center">
          <div className="text-3xl font-bold text-green-600">{stats.generated}</div>
          <div className="text-sm text-gray-600">Générés</div>
        </div>
      </div>

      <div className="flex gap-4 mb-6">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">Filtrer par statut</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">Tous</option>
            <option value="pending">En attente</option>
            <option value="generating">En cours</option>
            <option value="generated">Généré</option>
            <option value="error">Erreur</option>
          </select>
        </div>
        {prompts.length > 0 && (
          <div className="flex items-end">
            <button
              onClick={deleteAll}
              className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-semibold transition-all"
            >
              🗑️ Tout supprimer
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin text-4xl mb-4">⏳</div>
          <p className="text-gray-500">Chargement...</p>
        </div>
      ) : prompts.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-xl">
          <div className="text-6xl mb-4">📭</div>
          <p className="text-gray-600 font-medium">Aucun prompt trouvé</p>
          <p className="text-gray-400 text-sm mt-2">Utilise l'analyseur de site ci-dessus pour générer des prompts</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="text-left px-4 py-3 font-semibold text-gray-700 w-1/2">Prompt</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Format</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Type</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Statut</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {prompts.map((prompt) => (
                <tr key={prompt.id} className="border-b hover:bg-gray-50">
                  {editingId === prompt.id ? (
                    <>
                      <td className="px-4 py-3">
                        <textarea
                          value={editValues.prompt || ''}
                          onChange={(e) => setEditValues(prev => ({ ...prev, prompt: e.target.value }))}
                          className="w-full px-2 py-1 border rounded text-sm"
                          rows={3}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={editValues.format || '9:16'}
                          onChange={(e) => setEditValues(prev => ({ ...prev, format: e.target.value }))}
                          className="px-2 py-1 border rounded text-sm"
                        >
                          <option value="9:16">9:16</option>
                          <option value="1:1">1:1</option>
                          <option value="16:9">16:9</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={editValues.type || 'photo'}
                          onChange={(e) => setEditValues(prev => ({ ...prev, type: e.target.value }))}
                          className="px-2 py-1 border rounded text-sm"
                        >
                          <option value="photo">Photo</option>
                          <option value="video">Vidéo</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={editValues.status || 'pending'}
                          onChange={(e) => setEditValues(prev => ({ ...prev, status: e.target.value }))}
                          className="px-2 py-1 border rounded text-sm"
                        >
                          <option value="pending">En attente</option>
                          <option value="generated">Généré</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button onClick={() => saveEdit(prompt.id)} className="px-2 py-1 bg-green-600 text-white rounded text-xs font-semibold">✓</button>
                          <button onClick={cancelEdit} className="px-2 py-1 bg-gray-400 text-white rounded text-xs font-semibold">✕</button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3">
                        <p className="text-sm text-gray-700 line-clamp-2">{prompt.prompt}</p>
                        {prompt.angle && (
                          <span className="inline-block mt-1 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">
                            {prompt.angle}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm">{prompt.format}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-sm ${prompt.type === 'video' ? 'text-red-600' : 'text-gray-600'}`}>
                          {prompt.type === 'video' ? '🎬' : '📷'} {prompt.type}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          prompt.status === 'pending' ? 'bg-orange-100 text-orange-700' :
                          prompt.status === 'generating' ? 'bg-blue-100 text-blue-700' :
                          prompt.status === 'generated' ? 'bg-green-100 text-green-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {prompt.status === 'pending' ? '⏳ En attente' :
                           prompt.status === 'generating' ? '🔄 En cours' :
                           prompt.status === 'generated' ? '✅ Généré' :
                           '❌ Erreur'}
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

      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4">➕ Ajouter un prompt</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Prompt *</label>
                <textarea
                  value={newPrompt.prompt}
                  onChange={(e) => setNewPrompt(prev => ({ ...prev, prompt: e.target.value }))}
                  placeholder="Description visuelle détaillée en anglais..."
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Format</label>
                  <select
                    value={newPrompt.format}
                    onChange={(e) => setNewPrompt(prev => ({ ...prev, format: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  >
                    <option value="9:16">9:16 (Story/Reel)</option>
                    <option value="1:1">1:1 (Carré)</option>
                    <option value="16:9">16:9 (Paysage)</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                  <select
                    value={newPrompt.type}
                    onChange={(e) => setNewPrompt(prev => ({ ...prev, type: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  >
                    <option value="photo">📷 Photo</option>
                    <option value="video">🎬 Vidéo</option>
                  </select>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Angle marketing</label>
                  <input
                    type="text"
                    value={newPrompt.angle}
                    onChange={(e) => setNewPrompt(prev => ({ ...prev, angle: e.target.value }))}
                    placeholder="Ex: Social proof, Lifestyle..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Concept créatif</label>
                  <input
                    type="text"
                    value={newPrompt.concept}
                    onChange={(e) => setNewPrompt(prev => ({ ...prev, concept: e.target.value }))}
                    placeholder="Ex: UGC, Flat lay..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
            </div>
            
            <div className="flex gap-2 mt-6">
              <button onClick={addPrompt} className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold">✅ Ajouter</button>
              <button onClick={() => setShowAddModal(false)} className="flex-1 px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-700 rounded-lg font-semibold">Annuler</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

PromptsTable.displayName = 'PromptsTable';

export default PromptsTable;

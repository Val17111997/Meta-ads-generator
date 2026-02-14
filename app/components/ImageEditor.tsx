'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

// Fabric.js types
declare const fabric: any;

interface ImageEditorProps {
  imageUrl: string;
  onClose: () => void;
  onSave?: (dataUrl: string) => void;
}

const FONTS = [
  'Arial', 'Helvetica', 'Impact', 'Georgia', 'Montserrat', 'Playfair Display',
  'Oswald', 'Bebas Neue', 'Roboto', 'Poppins', 'Lato', 'Raleway'
];

const PRESET_COLORS = [
  '#FFFFFF', '#000000', '#FF3B30', '#FF9500', '#FFCC00', '#34C759',
  '#007AFF', '#5856D6', '#AF52DE', '#FF2D55', '#A2845E', '#8E8E93'
];

const PRESET_BG_COLORS = [
  'transparent', '#000000CC', '#FFFFFFCC', '#FF3B30CC', '#FF9500CC',
  '#007AFFCC', '#5856D6CC', '#000000', '#FFFFFF', '#FF3B30'
];

export default function ImageEditor({ imageUrl, onClose, onSave }: ImageEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [text, setText] = useState('Votre texte ici');
  const [fontSize, setFontSize] = useState(48);
  const [fontFamily, setFontFamily] = useState('Arial');
  const [textColor, setTextColor] = useState('#FFFFFF');
  const [bgColor, setBgColor] = useState('#000000CC');
  const [bgPadding, setBgPadding] = useState(12);
  const [bgStyle, setBgStyle] = useState<'none' | 'highlight' | 'box' | 'rounded'>('rounded');
  const [bold, setBold] = useState(true);
  const [italic, setItalic] = useState(false);
  const [uppercase, setUppercase] = useState(false);
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>('center');
  const [loaded, setLoaded] = useState(false);
  const [imgDimensions, setImgDimensions] = useState({ width: 800, height: 800 });

  // Load Fabric.js from CDN
  useEffect(() => {
    if (typeof window !== 'undefined' && !(window as any).fabric) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js';
      script.onload = () => initCanvas();
      document.head.appendChild(script);

      // Load Google Fonts
      const link = document.createElement('link');
      link.href = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700;900&family=Playfair+Display:wght@400;700&family=Oswald:wght@400;700&family=Bebas+Neue&family=Roboto:wght@400;700&family=Poppins:wght@400;600;700&family=Lato:wght@400;700&family=Raleway:wght@400;700&display=swap';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    } else {
      initCanvas();
    }
  }, []);

  const initCanvas = useCallback(() => {
    if (!canvasRef.current || fabricRef.current) return;
    const f = (window as any).fabric;
    if (!f) return;

    const canvas = new f.Canvas(canvasRef.current, {
      backgroundColor: '#f3f4f6',
      selection: true,
    });
    fabricRef.current = canvas;

    // Load background image
    f.Image.fromURL(imageUrl, (img: any) => {
      const maxW = 800;
      const maxH = 800;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);

      canvas.setWidth(w);
      canvas.setHeight(h);
      setImgDimensions({ width: w, height: h });

      img.set({ scaleX: scale, scaleY: scale, selectable: false, evented: false });
      canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas));
      setLoaded(true);
    }, { crossOrigin: 'anonymous' });
  }, [imageUrl]);

  const addTextToCanvas = () => {
    const f = (window as any).fabric;
    const canvas = fabricRef.current;
    if (!f || !canvas) return;

    const displayText = uppercase ? text.toUpperCase() : text;

    if (bgStyle === 'none') {
      // Simple text, no background
      const textObj = new f.IText(displayText, {
        left: imgDimensions.width / 2,
        top: imgDimensions.height / 2,
        originX: 'center',
        originY: 'center',
        fontFamily,
        fontSize,
        fill: textColor,
        fontWeight: bold ? 'bold' : 'normal',
        fontStyle: italic ? 'italic' : 'normal',
        textAlign,
        shadow: new f.Shadow({ color: 'rgba(0,0,0,0.5)', blur: 4, offsetX: 2, offsetY: 2 }),
        editable: true,
      });
      canvas.add(textObj);
      canvas.setActiveObject(textObj);
    } else {
      // Text with background — use a group
      const textObj = new f.Text(displayText, {
        fontFamily,
        fontSize,
        fill: textColor,
        fontWeight: bold ? 'bold' : 'normal',
        fontStyle: italic ? 'italic' : 'normal',
        textAlign,
        originX: 'center',
        originY: 'center',
      });

      const pad = bgPadding;
      const rectWidth = textObj.width + pad * 2;
      const rectHeight = textObj.height + pad * 2;

      const rect = new f.Rect({
        width: rectWidth,
        height: rectHeight,
        fill: bgColor,
        rx: bgStyle === 'rounded' ? 8 : 0,
        ry: bgStyle === 'rounded' ? 8 : 0,
        originX: 'center',
        originY: 'center',
      });

      const group = new f.Group([rect, textObj], {
        left: imgDimensions.width / 2,
        top: imgDimensions.height / 2,
        originX: 'center',
        originY: 'center',
      });

      canvas.add(group);
      canvas.setActiveObject(group);
    }

    canvas.renderAll();
  };

  const deleteSelected = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObjects();
    if (active.length) {
      active.forEach((obj: any) => canvas.remove(obj));
      canvas.discardActiveObject();
      canvas.renderAll();
    }
  };

  const exportImage = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.discardActiveObject();
    canvas.renderAll();
    const dataUrl = canvas.toDataURL({ format: 'png', quality: 1, multiplier: 2 });
    
    // Download
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `content-edited-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    if (onSave) onSave(dataUrl);
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={containerRef} className="bg-white rounded-2xl shadow-2xl max-w-[1200px] w-full mx-4 max-h-[95vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-800">✏️ Éditeur de texte</h2>
          <div className="flex items-center gap-3">
            <button onClick={exportImage} className="px-5 py-2 bg-gradient-to-r from-violet-500 to-purple-500 text-white rounded-lg text-sm font-bold hover:shadow-lg transition-all">
              📥 Exporter PNG
            </button>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 text-sm">✕</button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left: Canvas */}
          <div className="flex-1 flex items-center justify-center bg-gray-100 p-4 overflow-auto">
            {!loaded && (
              <div className="text-gray-400 text-sm">Chargement de l'image...</div>
            )}
            <canvas ref={canvasRef} />
          </div>

          {/* Right: Controls */}
          <div className="w-80 border-l border-gray-200 overflow-y-auto p-5 space-y-5">
            
            {/* Text input */}
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">Texte</label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={2}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 resize-none"
                placeholder="Votre texte..."
              />
            </div>

            {/* Font */}
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">Police</label>
              <select
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
              >
                {FONTS.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
              </select>
            </div>

            {/* Size + Style */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">Taille</label>
                <input
                  type="range"
                  min={16}
                  max={120}
                  value={fontSize}
                  onChange={(e) => setFontSize(parseInt(e.target.value))}
                  className="w-full accent-violet-500"
                />
                <span className="text-xs text-gray-400">{fontSize}px</span>
              </div>
            </div>

            {/* Style buttons */}
            <div className="flex gap-2">
              <button onClick={() => setBold(!bold)} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${bold ? 'bg-violet-100 text-violet-700 border-2 border-violet-300' : 'bg-gray-50 text-gray-400 border border-gray-200'}`}>
                B
              </button>
              <button onClick={() => setItalic(!italic)} className={`flex-1 py-2 rounded-lg text-sm transition-all ${italic ? 'bg-violet-100 text-violet-700 border-2 border-violet-300' : 'bg-gray-50 text-gray-400 border border-gray-200'}`}>
                <em>I</em>
              </button>
              <button onClick={() => setUppercase(!uppercase)} className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${uppercase ? 'bg-violet-100 text-violet-700 border-2 border-violet-300' : 'bg-gray-50 text-gray-400 border border-gray-200'}`}>
                AA
              </button>
              {(['left', 'center', 'right'] as const).map(a => (
                <button key={a} onClick={() => setTextAlign(a)} className={`flex-1 py-2 rounded-lg text-xs transition-all ${textAlign === a ? 'bg-violet-100 text-violet-700 border-2 border-violet-300' : 'bg-gray-50 text-gray-400 border border-gray-200'}`}>
                  {a === 'left' ? '◧' : a === 'center' ? '◫' : '◨'}
                </button>
              ))}
            </div>

            {/* Text color */}
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">Couleur du texte</label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setTextColor(c)}
                    className={`w-7 h-7 rounded-full border-2 transition-all ${textColor === c ? 'border-violet-500 scale-110' : 'border-gray-200'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
                <input
                  type="color"
                  value={textColor}
                  onChange={(e) => setTextColor(e.target.value)}
                  className="w-7 h-7 rounded-full cursor-pointer border-0"
                />
              </div>
            </div>

            {/* Background style */}
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">Style du fond</label>
              <div className="grid grid-cols-4 gap-2">
                {([
                  { id: 'none', label: 'Aucun', icon: 'T' },
                  { id: 'highlight', label: 'Surligné', icon: '▬T' },
                  { id: 'box', label: 'Rectangle', icon: '▮T' },
                  { id: 'rounded', label: 'Arrondi', icon: '⬤T' },
                ] as const).map(s => (
                  <button
                    key={s.id}
                    onClick={() => setBgStyle(s.id)}
                    className={`py-2 rounded-lg text-xs font-semibold transition-all ${bgStyle === s.id ? 'bg-violet-100 text-violet-700 border-2 border-violet-300' : 'bg-gray-50 text-gray-400 border border-gray-200'}`}
                  >
                    <div className="text-base">{s.icon}</div>
                    <div className="text-[9px] mt-0.5">{s.label}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Background color */}
            {bgStyle !== 'none' && (
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">Couleur du fond</label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_BG_COLORS.filter(c => c !== 'transparent').map(c => (
                    <button
                      key={c}
                      onClick={() => setBgColor(c)}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${bgColor === c ? 'border-violet-500 scale-110' : 'border-gray-200'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <input
                    type="color"
                    value={bgColor.substring(0, 7)}
                    onChange={(e) => setBgColor(e.target.value + 'CC')}
                    className="w-7 h-7 rounded-full cursor-pointer border-0"
                  />
                </div>
                <div className="mt-2">
                  <label className="text-[10px] text-gray-400">Padding: {bgPadding}px</label>
                  <input
                    type="range"
                    min={4}
                    max={40}
                    value={bgPadding}
                    onChange={(e) => setBgPadding(parseInt(e.target.value))}
                    className="w-full accent-violet-500"
                  />
                </div>
              </div>
            )}

            {/* Add button */}
            <button
              onClick={addTextToCanvas}
              className="w-full py-3 bg-gradient-to-r from-violet-500 to-purple-500 text-white rounded-xl text-sm font-bold hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all"
            >
              ➕ Ajouter le texte
            </button>

            {/* Delete selected */}
            <button
              onClick={deleteSelected}
              className="w-full py-2.5 bg-red-50 hover:bg-red-100 text-red-500 rounded-xl text-sm font-semibold border border-red-200 transition-all"
            >
              🗑️ Supprimer la sélection
            </button>

            <p className="text-[10px] text-gray-400 leading-relaxed">
              💡 Ajoute autant de textes que tu veux. Déplace-les et redimensionne-les sur l'image. Clique sur un texte pour le sélectionner.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

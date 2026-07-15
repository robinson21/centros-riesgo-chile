import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import './App.css';

const REGION_SLUGS = {
  'Arica y Parinacota': 'arica_y_parinacota',
  'Tarapacá': 'tarapaca',
  'Antofagasta': 'antofagasta',
  'Atacama': 'atacama',
  'Coquimbo': 'coquimbo',
  'Valparaíso': 'valparaiso',
  "Libertador General Bernardo O'Higgins": 'libertador_general_bernardo_ohiggins',
  'Maule': 'maule',
  'Ñuble': 'nuble',
  'Biobío': 'biobio',
  'La Araucanía': 'la_araucania',
  'Los Ríos': 'los_rios',
  'Los Lagos': 'los_lagos',
  'Aysén del General Carlos Ibáñez del Campo': 'aysen_del_general_carlos_ibanez_del_campo',
  'Magallanes y de la Antártica Chilena': 'magallanes_y_de_la_antartica_chilena',
  'Metropolitana de Santiago': 'metropolitana_de_santiago',
};
const STORAGE_KEY = 'centros-riesgo-centros';

function loadCentros() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveCentros(c) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
}

function toastMsg(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

export default function App() {
  const [metadata, setMetadata] = useState(null);
  const [loading, setLoading] = useState(true);
  const [centros, setCentros] = useState([]);
  const [buscar, setBuscar] = useState('');
  const [sugerencias, setSugerencias] = useState([]);
  const [regionFilter, setRegionFilter] = useState('');
  const [cargandoRegion, setCargandoRegion] = useState(null);
  const cache = useRef({});

  // Cargar metada
  useEffect(() => {
    fetch('./data/meta.json')
      .then(r => r.json())
      .then(m => { setMetadata(m); setLoading(false); })
      .catch(e => { setLoading(false); console.error(e); });
    setCentros(loadCentros());
  }, []);

  const regiones = useMemo(() => {
    if (!metadata?.regiones) return [];
    return Object.entries(metadata.regiones)
      .map(([k, v]) => ({ nombre: k, ...v }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [metadata]);

  // Buscador de comunas con autocomplete
  useEffect(() => {
    if (!buscar || !metadata) { setSugerencias([]); return; }
    const q = buscar.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const results = [];
    for (const [region, info] of Object.entries(metadata.regiones || {})) {
      for (const c of info.comunas || []) {
        if (results.length >= 20) break;
        if (c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(q)) {
          results.push({ comuna: c, region });
        }
      }
      if (results.length >= 20) break;
    }
    setSugerencias(results);
    if (regionFilter && regionFilter !== 'todas') {
      const filtered = results.filter(r => r.region === regionFilter || regionFilter === 'todas');
      setSugerencias(filtered.slice(0, 20));
    }
  }, [buscar, metadata, regionFilter]);

  const yaAgregada = (comuna) => centros.some(c => c.comuna === comuna);

  const agregarCentro = useCallback((comuna, region) => {
    if (yaAgregada(comuna)) { toastMsg('⚠️ Ya tienes esta comuna agregada'); return; }
    const slug = REGION_SLUGS[region];
    if (!slug) { toastMsg('❌ Región no encontrada'); return; }
    setCargandoRegion(comuna);

    if (cache.current[comuna]) {
      const data = cache.current[comuna];
      const nuevo = { id: Date.now(), comuna, region, ...data };
      setCentros(prev => { const n = [...prev, nuevo]; saveCentros(n); return n; });
      setCargandoRegion(null);
      setBuscar('');
      setSugerencias([]);
      toastMsg(`✅ ${comuna} agregado`);
      return;
    }

    fetch(`./data/${slug}.json`)
      .then(r => r.json())
      .then(data => {
        const ptsComuna = data.filter(p => p.comuna === comuna);
        cache.current[comuna] = { total: ptsComuna.length, puntos: ptsComuna };
        const nuevo = { id: Date.now(), comuna, region, total: ptsComuna.length, puntos: ptsComuna };
        setCentros(prev => { const n = [...prev, nuevo]; saveCentros(n); return n; });
        setBuscar('');
        setSugerencias([]);
        toastMsg(`✅ ${comuna} agregado (${ptsComuna.length} pts)`);
      })
      .catch(() => toastMsg(`❌ Error cargando ${comuna}`))
      .finally(() => setCargandoRegion(null));
  }, [centros, regionFilter]);

  const quitarCentro = useCallback((id) => {
    const c = centros.find(c => c.id === id);
    setCentros(prev => { const n = prev.filter(c => c.id !== id); saveCentros(n); return n; });
    if (c) toastMsg(`✕ ${c.comuna} eliminado`);
  }, [centros]);

  // Estadísticas consolidadas
  const stats = useMemo(() => {
    if (!centros.length) return null;
    let totalPts = 0;
    const niveles = { 'Muy Alto': 0, 'Alto': 0, 'Medio': 0, 'Bajo': 0 };
    const causas = {};
    centros.forEach(c => {
      totalPts += c.total || 0;
      (c.puntos || []).forEach(p => {
        if (niveles[p.nivel] !== undefined) niveles[p.nivel]++;
        const causa = p.causa || p.causa_ppal || 'Sin especificar';
        causas[causa] = (causas[causa] || 0) + 1;
      });
    });
    const causasOrd = Object.entries(causas).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { totalPts, niveles, causas: causasOrd };
  }, [centros]);

  const exportCSV = () => {
    let csv = 'Comuna,Región,Total Puntos,Muy Alto,Alto,Medio,Bajo\n';
    centros.forEach(c => {
      const pts = c.puntos || [];
      const ma = pts.filter(p => p.nivel === 'Muy Alto').length;
      const al = pts.filter(p => p.nivel === 'Alto').length;
      const me = pts.filter(p => p.nivel === 'Medio').length;
      const ba = pts.filter(p => p.nivel === 'Bajo').length;
      csv += `"${c.comuna}","${c.region}",${c.total || 0},${ma},${al},${me},${ba}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'centros-riesgo.csv'; a.click();
    URL.revokeObjectURL(url);
    toastMsg('📥 CSV descargado');
  };

  const copiarResumen = () => {
    let txt = '=== MIS CENTROS DE TRABAJO ===\n\n';
    centros.forEach(c => {
      const pts = c.puntos || [];
      const ma = pts.filter(p => p.nivel === 'Muy Alto').length;
      const al = pts.filter(p => p.nivel === 'Alto').length;
      const me = pts.filter(p => p.nivel === 'Medio').length;
      const ba = pts.filter(p => p.nivel === 'Bajo').length;
      txt += `🏭 ${c.comuna} (${c.region})\n`;
      txt += `   Total: ${c.total || 0} pts | Alto: ${ma} | Medio: ${me} | Bajo: ${ba}\n`;
      if (ma > 0) txt += `   ⚠️  ${ma} Muy Alto - requiere atención\n`;
      txt += '\n';
    });
    if (stats) txt += `TOTAL: ${stats.totalPts} puntos en ${centros.length} centros\n`;
    navigator.clipboard.writeText(txt).then(() => toastMsg('📋 Copiado al portapapeles'));
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner"></div>
        <p>Cargando datos...</p>
      </div>
    );
  }

  return (
    <div className="wrap">
      <header>
        <p className="eyebrow">🇨🇱 Chile · Datos SENAPRED</p>
        <h1>Centros de Riesgo</h1>
        <p className="subtitle">
          Gestiona tus centros de trabajo. Selecciona comunas y visualiza los riesgos consolidados del catastro de puntos críticos SENAPRED.
        </p>
        <div className="meta">
          <div><b>Comunas disponibles:</b> {metadata?.comunas || 0}</div>
          <div><b>Total puntos:</b> {metadata?.total?.toLocaleString('es-CL') || 0}</div>
          <div><b>Tus centros:</b> {centros.length}</div>
        </div>
      </header>

      {/* BUSCADOR Y AÑADIR */}
      <div className="buscar-anexar" style={{ position: 'relative' }}>
        <div className="panel-head">
          <h2>➕ Añadir Centro de Trabajo</h2>
        </div>
        <div style={{ padding: '14px 18px' }}>
          <div className="input-row">
            <div style={{ flex: 1, position: 'relative' }}>
              <input
                type="text"
                placeholder="Buscar comuna…"
                value={buscar}
                onChange={e => setBuscar(e.target.value)}
              />
              {sugerencias.length > 0 && (
                <div className="suggestions">
                  {sugerencias.map((s, i) => (
                    <div key={i} onClick={() => agregarCentro(s.comuna, s.region)}>
                      {s.comuna}
                      <span className="reg">— {s.region}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)} style={{ maxWidth: 200 }}>
              <option value="">Todas las regiones</option>
              {regiones.map(r => (
                <option key={r.nombre} value={r.nombre}>{r.nombre}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* RESUMEN */}
      {centros.length > 0 && stats && (
        <div className="resumen">
          <div className="panel-head">
            <h2>📊 Resumen Consolidado</h2>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn-export" onClick={copiarResumen}>📋 Copiar</button>
              <button className="btn-export" onClick={exportCSV}>📥 CSV</button>
            </div>
          </div>
          <div className="resumen-body">
            <div className="resumen-top">
              <div className="resumen-stat">
                <strong>{stats.totalPts}</strong>
                Puntos totales
              </div>
              <div className="resumen-stat">
                <strong>{centros.length}</strong>
                Centros
              </div>
              <div className="resumen-stat">
                <strong>{stats.niveles['Muy Alto']}</strong>
                Muy Alto
              </div>
              <div className="resumen-stat">
                <strong>{stats.niveles['Alto']}</strong>
                Alto
              </div>
              <div className="resumen-stat">
                <strong>{stats.niveles['Medio']}</strong>
                Medio
              </div>
              <div className="resumen-stat">
                <strong>{stats.niveles['Bajo']}</strong>
                Bajo
              </div>
            </div>
            <div className="resumen-barras">
              {(() => {
                const t = stats.niveles['Muy Alto'] + stats.niveles['Alto'] + stats.niveles['Medio'] + stats.niveles['Bajo'] || 1;
                return (
                  <>
                    <div style={{ width: `${(stats.niveles['Muy Alto'] / t) * 100}%`, background: '#ef4444', minWidth: stats.niveles['Muy Alto'] > 0 ? 8 : 0 }} />
                    <div style={{ width: `${(stats.niveles['Alto'] / t) * 100}%`, background: '#f97316', minWidth: stats.niveles['Alto'] > 0 ? 8 : 0 }} />
                    <div style={{ width: `${(stats.niveles['Medio'] / t) * 100}%`, background: '#f59e0b', minWidth: stats.niveles['Medio'] > 0 ? 8 : 0 }} />
                    <div style={{ width: `${(stats.niveles['Bajo'] / t) * 100}%`, background: '#22c55e', minWidth: stats.niveles['Bajo'] > 0 ? 8 : 0 }} />
                  </>
                );
              })()}
            </div>
            <div className="resumen-leyenda">
              <span><span className="dot" style={{ background: '#ef4444' }} /> Muy Alto {stats.niveles['Muy Alto']}</span>
              <span><span className="dot" style={{ background: '#f97316' }} /> Alto {stats.niveles['Alto']}</span>
              <span><span className="dot" style={{ background: '#f59e0b' }} /> Medio {stats.niveles['Medio']}</span>
              <span><span className="dot" style={{ background: '#22c55e' }} /> Bajo {stats.niveles['Bajo']}</span>
            </div>
            {stats.causas.length > 0 && (
              <div className="resumen-causas">
                <strong>Principales causas:</strong>{' '}
                {stats.causas.map(([c, n], i) => (
                  <span key={c}>{i > 0 && ' · '}{c} ({n})</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* LISTA DE CENTROS */}
      {centros.length === 0 ? (
        <div className="empty-centros">
          <p>🏗️ No tienes centros de trabajo agregados</p>
          <p className="sub">Busca una comuna arriba y haz clic para agregarla</p>
        </div>
      ) : (
        <div className="centros-grid">
          {centros.map(c => {
            const pts = c.puntos || [];
            const ma = pts.filter(p => p.nivel === 'Muy Alto').length;
            const al = pts.filter(p => p.nivel === 'Alto').length;
            const me = pts.filter(p => p.nivel === 'Medio').length;
            const ba = pts.filter(p => p.nivel === 'Bajo').length;
            const causas = {};
            pts.forEach(p => {
              const causa = p.causa || p.causa_ppal || 'Sin especificar';
              causas[causa] = (causas[causa] || 0) + 1;
            });
            const topCausas = Object.entries(causas).sort((a, b) => b[1] - a[1]).slice(0, 3);

            return (
              <div key={c.id} className="centro-card">
                <div className="centro-card-header">
                  <h3>🏭 {c.comuna}</h3>
                  <button className="centro-del" onClick={() => quitarCentro(c.id)} title="Eliminar">✕</button>
                </div>
                <div className="centro-card-body">
                  <div className="centro-stat">
                    <span className="pill">{c.total || 0} pts</span>
                    {ma > 0 && <span className="pill muy-alto">{ma} Muy Alto</span>}
                    {al > 0 && <span className="pill alto">{al} Alto</span>}
                    {me > 0 && <span className="pill medio">{me} Medio</span>}
                    {ba > 0 && <span className="pill bajo">{ba} Bajo</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted-2)', marginBottom: 8 }}>
                    {c.region}
                  </div>
                  {topCausas.length > 0 && (
                    <div className="centro-causas">
                      <strong>Riesgos ppal.:</strong>{' '}
                      {topCausas.map(([cau, n], i) => (
                        <span key={cau}>{i > 0 && ' · '}{cau} ({n})</span>
                      ))}
                    </div>
                  )}
                  {ma > 0 && (
                    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--red)', fontWeight: 500 }}>
                      ⚠️ {ma} punto(s) Muy Alto — requiere atención
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {cargandoRegion && <div className="loading-bar">Cargando {cargandoRegion}…</div>}

      <footer>
        <span>Centros de Riesgo Chile · GesstIA</span>
        <span>Datos: SENAPRED · DMC</span>
        <span>v1.0 — 2026</span>
      </footer>
    </div>
  );
}

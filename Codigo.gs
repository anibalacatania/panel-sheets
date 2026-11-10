/**
 * Panel Sensorial por Sesiones — servidor en Google Apps Script
 *
 * Hojas que usa (se crean solas):
 *   Config      -> ClaveAdmin y nombre del estudio
 *   Atributos   -> un atributo por fila (columna "Nombre")
 *   Sesiones    -> Sesion | NMuestras | Vinos
 *   Diseno      -> Sesion | Valuador | Orden | NombreProducto | Rep | CodigoProducto
 *                  (Rep = repetición de ese vino: 1ª, 2ª, 3ª vez que pasa por el panel)
 *   Respuestas  -> una fila por muestra evaluada (se actualiza si el panelista corrige)
 *
 * Todas las llamadas son POST con un JSON { accion: "...", ... }.
 */

const HOJA = {
  CONFIG: 'Config',
  ATR: 'Atributos',
  SES: 'Sesiones',
  DIS: 'Diseno',
  RES: 'Respuestas',
};

// ---------------------------------------------------------------- entrada
function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'JSON inválido' });
  }
  try {
    const fn = ACCIONES[req.accion];
    if (!fn) return json_({ ok: false, error: 'Acción desconocida: ' + req.accion });
    return json_(fn(req));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function doGet() {
  return json_({ ok: true, mensaje: 'Panel Sensorial (sesiones) activo' });
}

const ACCIONES = {
  // ---- públicas (panelistas)
  // Una sola llamada con todo lo que necesita la app. Sin nombres de vinos (cata a ciegas).
  inicio: function () {
    const b = base_();
    return {
      ok: true,
      estudio: b.estudio,
      atributos: b.atributos,
      sesiones: b.sesiones,
      panelistas: b.panelistas,
      // [Sesion, Valuador, Orden, CodigoProducto]
      diseno: b.diseno.map(r => [r[0], r[1], r[2], r[5]]),
      progreso: respondidas_(),
    };
  },

  // (compatibilidad con versiones anteriores de la app)
  config: function () {
    const b = base_();
    return { ok: true, estudio: b.estudio, atributos: b.atributos, sesiones: b.sesiones, panelistas: b.panelistas };
  },

  panelista: function (req) {
    const v = String(req.valuador || '').trim();
    const diseno = base_().diseno.filter(r => r[1] === v).map(r => ({
      Sesion: r[0], Valuador: r[1], Orden: r[2], CodigoProducto: r[5],
    }));
    const prog = respondidas_(), out = {};
    Object.keys(prog).forEach(k => { const p = k.split('|'); if (p[0] === v) out[p[1]] = prog[k]; });
    return { ok: true, diseno: diseno, progreso: out };
  },

  guardar: function (req) {
    const filas = Array.isArray(req.filas) ? req.filas : (req.fila ? [req.fila] : []);
    if (!filas.length) return { ok: true, guardadas: 0 };
    // el vino y su repetición los completa el servidor desde el diseño (la app no los conoce)
    const info = {};
    base_().diseno.forEach(r => { info[r[1] + '|' + r[0] + '|' + r[2]] = r; });
    const completas = filas.map(f => {
      const d = info[f.Valuador + '|' + f.Sesion + '|' + Number(f.Orden)];
      const o = { id: f.id, Sesion: f.Sesion, Valuador: f.Valuador, Orden: f.Orden,
        NombreProducto: d ? d[3] : (f.NombreProducto || ''), Rep: d ? d[4] : (f.Rep || ''),
        CodigoProducto: f.CodigoProducto, timestamp: f.timestamp };
      Object.keys(f).forEach(k => { if (!(k in o)) o[k] = f[k]; }); // atributos
      return o;
    });
    const lock = LockService.getScriptLock();
    lock.waitLock(25000);
    try {
      const hoja = hoja_(HOJA.RES);
      completas.forEach(f => upsert_(hoja, f));
    } finally {
      lock.releaseLock();
    }
    return { ok: true, guardadas: filas.length };
  },

  // ---- administrador (requieren clave)
  adminLogin: function (req) {
    verificarAdmin_(req);
    return { ok: true, estudio: valorConfig_('Estudio') || '' };
  },

  adminGuardarDiseno: function (req) {
    verificarAdmin_(req);
    const lock = LockService.getScriptLock();
    lock.waitLock(25000);
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const res = ss.getSheetByName(HOJA.RES);
      if (res && res.getLastRow() > 1) {
        if (!req.forzar) {
          return { ok: false, hayRespuestas: true, error: 'Ya hay respuestas cargadas para el diseño actual.' };
        }
        // No se borra nada: se renombra la hoja como respaldo
        res.setName('Respuestas_respaldo_' + Utilities.formatDate(new Date(), 'GMT-3', 'yyyyMMdd_HHmm'));
      }
      if (req.estudio) setConfig_('Estudio', String(req.estudio));
      escribir_(HOJA.ATR, ['Nombre'], (req.atributos || []).map(a => [a]));
      escribir_(HOJA.SES, ['Sesion', 'NMuestras', 'Vinos'],
        (req.sesiones || []).map(s => [s.Sesion, s.NMuestras, s.Vinos]));
      escribir_(HOJA.DIS, ['Sesion', 'Valuador', 'Orden', 'NombreProducto', 'Rep', 'CodigoProducto'],
        (req.diseno || []).map(d => [d.Sesion, d.Valuador, d.Orden, d.NombreProducto, d.Rep, d.CodigoProducto]));
      borrarMemoria_();
      return { ok: true };
    } finally {
      lock.releaseLock();
    }
  },

  adminEstado: function (req) {
    verificarAdmin_(req);
    const diseno = leer_(HOJA.DIS).map(r => ({
      Sesion: String(r.Sesion), Valuador: String(r.Valuador), Orden: Number(r.Orden),
      NombreProducto: String(r.NombreProducto), Rep: Number(r.Rep), CodigoProducto: String(r.CodigoProducto),
    }));
    const respondidas = {};
    leer_(HOJA.RES).forEach(r => {
      const k = String(r.Valuador) + '|' + String(r.Sesion);
      respondidas[k] = respondidas[k] || {};
      respondidas[k][Number(r.Orden)] = true;
    });
    const conteo = {};
    Object.keys(respondidas).forEach(k => { conteo[k] = Object.keys(respondidas[k]).length; });
    return {
      ok: true,
      estudio: valorConfig_('Estudio') || '',
      atributos: leerAtributos_(),
      sesiones: leer_(HOJA.SES).map(s => ({
        Sesion: String(s.Sesion), NMuestras: Number(s.NMuestras), Vinos: String(s.Vinos),
      })),
      diseno: diseno,
      conteo: conteo,
    };
  },
};

// ---------------------------------------------------------------- memoria rápida
// El diseño, las sesiones y los atributos se guardan 10 minutos en la caché de Google,
// así no hay que leer la planilla en cada llamada. Se borra al guardar un diseño nuevo.
// Si editás a mano las hojas Diseno/Sesiones/Atributos, el cambio aparece en hasta 10 min
// (o ejecutá refrescarMemoria desde el editor para que sea inmediato).
const MEMORIA_SEG = 600;

function base_() {
  const enMemoria = memoriaLeer_('base');
  if (enMemoria) return enMemoria;
  // [Sesion, Valuador, Orden, NombreProducto, Rep, CodigoProducto]
  const diseno = leer_(HOJA.DIS).map(r => [
    String(r.Sesion), String(r.Valuador), Number(r.Orden), String(r.NombreProducto), Number(r.Rep), String(r.CodigoProducto),
  ]);
  const b = {
    estudio: valorConfig_('Estudio') || 'Análisis Sensorial',
    atributos: leerAtributos_(),
    sesiones: leer_(HOJA.SES).map(s => ({ Sesion: String(s.Sesion), NMuestras: Number(s.NMuestras) })),
    panelistas: unicos_(diseno.map(r => r[1])),
    diseno: diseno,
  };
  memoriaGuardar_('base', b);
  return b;
}

function memoriaLeer_(clave) {
  try {
    const c = CacheService.getScriptCache();
    const n = Number(c.get(clave + ':n') || 0);
    if (!n) return null;
    const claves = [];
    for (let i = 0; i < n; i++) claves.push(clave + ':' + i);
    const partes = c.getAll(claves);
    let txt = '';
    for (let i = 0; i < claves.length; i++) {
      if (partes[claves[i]] == null) return null;
      txt += partes[claves[i]];
    }
    return JSON.parse(txt);
  } catch (e) { return null; }
}

function memoriaGuardar_(clave, obj) {
  try {
    const txt = JSON.stringify(obj), T = 30000; // trozos chicos: límite de 100 KB por valor
    const n = Math.max(1, Math.ceil(txt.length / T)), m = {};
    for (let i = 0; i < n; i++) m[clave + ':' + i] = txt.slice(i * T, (i + 1) * T);
    m[clave + ':n'] = String(n);
    CacheService.getScriptCache().putAll(m, MEMORIA_SEG);
  } catch (e) { /* si no entra en la caché, se lee de la planilla */ }
}

// Para usar desde el editor (menú Ejecutar) después de editar hojas a mano
function refrescarMemoria() { borrarMemoria_(); }

function borrarMemoria_() {
  try { CacheService.getScriptCache().remove('base:n'); } catch (e) {}
}

// órdenes respondidas: { "V1|S1": [1,2,3], ... }  (lee solo 3 columnas)
function respondidas_() {
  const h = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA.RES);
  if (!h || h.getLastRow() < 2) return {};
  const head = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0].map(String);
  const iV = head.indexOf('Valuador'), iS = head.indexOf('Sesion'), iO = head.indexOf('Orden');
  if (iV < 0 || iS < 0 || iO < 0) return {};
  const n = h.getLastRow() - 1;
  const col = i => h.getRange(2, i + 1, n, 1).getValues();
  const V = col(iV), S = col(iS), O = col(iO), out = {};
  for (let i = 0; i < n; i++) {
    if (V[i][0] === '') continue;
    const k = String(V[i][0]) + '|' + String(S[i][0]);
    const o = Number(O[i][0]);
    (out[k] = out[k] || []);
    if (out[k].indexOf(o) === -1) out[k].push(o);
  }
  return out;
}

// ---------------------------------------------------------------- helpers
function verificarAdmin_(req) {
  const clave = valorConfig_('ClaveAdmin');
  if (!clave || String(req.clave || '') !== String(clave)) throw new Error('Clave de administrador incorrecta');
}

function hoja_(nombre) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(nombre) || ss.insertSheet(nombre);
}

function leer_(nombre) {
  const h = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre);
  if (!h || h.getLastRow() < 2) return [];
  const v = h.getDataRange().getValues();
  const head = v[0].map(String);
  return v.slice(1).filter(r => r.some(x => x !== '')).map(r => {
    const o = {};
    head.forEach((k, i) => { o[k] = r[i]; });
    return o;
  });
}

function escribir_(nombre, headers, filas) {
  const h = hoja_(nombre);
  h.clearContents();
  h.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (filas.length) {
    // texto plano para que "Sesion", "Muestra" y códigos no se conviertan
    h.getRange(2, 1, filas.length, headers.length).setNumberFormat('@').setValues(filas.map(f => f.map(String)));
  }
  h.setFrozenRows(1);
}

function leerAtributos_() {
  return leer_(HOJA.ATR).map(r => String(r.Nombre || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function valorConfig_(clave) {
  const filas = leer_(HOJA.CONFIG);
  const f = filas.find(r => String(r.Clave) === clave);
  return f ? f.Valor : '';
}

function setConfig_(clave, valor) {
  const h = hoja_(HOJA.CONFIG);
  if (h.getLastRow() < 1) h.getRange(1, 1, 1, 2).setValues([['Clave', 'Valor']]);
  const v = h.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][0]) === clave) { h.getRange(i + 1, 2).setValue(valor); return; }
  }
  h.appendRow([clave, valor]);
}

function unicos_(arr) {
  return Array.from(new Set(arr.filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function upsert_(hoja, obj) {
  let headers = [];
  if (hoja.getLastColumn() > 0) {
    headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(String);
  }
  const nuevos = Object.keys(obj).filter(k => headers.indexOf(k) === -1);
  if (nuevos.length) {
    hoja.getRange(1, headers.length + 1, 1, nuevos.length).setValues([nuevos]);
    headers = headers.concat(nuevos);
    hoja.setFrozenRows(1);
  }
  const fila = headers.map(h => (obj[h] === undefined ? '' : obj[h]));
  const colId = headers.indexOf('id') + 1;
  if (colId > 0 && obj.id && hoja.getLastRow() > 1) {
    const enc = hoja.getRange(2, colId, hoja.getLastRow() - 1, 1)
      .createTextFinder(String(obj.id)).matchEntireCell(true).findNext();
    if (enc) {
      hoja.getRange(enc.getRow(), 1, 1, headers.length).setValues([fila]);
      return;
    }
  }
  hoja.appendRow(fila);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------- puesta en marcha
// Ejecutar UNA vez desde el editor: crea las hojas, atributos de ejemplo y una clave de administrador.
function configurar() {
  if (!valorConfig_('ClaveAdmin')) {
    setConfig_('ClaveAdmin', String(Math.floor(100000 + Math.random() * 900000)));
  }
  if (!valorConfig_('Estudio')) setConfig_('Estudio', 'Análisis Sensorial');
  if (!leerAtributos_().length) {
    escribir_(HOJA.ATR, ['Nombre'], [
      'intensidad de color', 'tonalidad violeta', 'tonalidad rojiza', 'Frutilla', 'Canela', 'Ciruela',
      'Mermelada de frutos rojos', 'acetaldehido', 'alcohol', 'pimiento', 'herbáceo', 'vainilla', 'lácteo',
      'manzana roja', 'caramelo', 'manzana verde', 'Astringencia', 'Acidez', 'Dulce', 'Amargo',
    ].map(a => [a]));
  }
  hoja_(HOJA.SES); hoja_(HOJA.DIS);
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Hoja 1') ||
             SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sheet1');
  if (sh && SpreadsheetApp.getActiveSpreadsheet().getSheets().length > 1 && sh.getLastRow() === 0) {
    SpreadsheetApp.getActiveSpreadsheet().deleteSheet(sh);
  }
  Logger.log('Clave de administrador: ' + valorConfig_('ClaveAdmin'));
}

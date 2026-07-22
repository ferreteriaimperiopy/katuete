/* ============================================================
   IMPERIO FERRETERÍA — CRM
   app.js  |  Lógica principal (Firebase + localStorage)
   ============================================================ */

'use strict';

// =====================================
// CONFIGURACIÓN FIREBASE
// =====================================
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyCpH0bKDExhswFXkNKv4k-GvszcB4EjyZw",
  authDomain:        "imperioferreteriakatuete.firebaseapp.com",
  projectId:         "imperioferreteriakatuete",
  storageBucket:     "imperioferreteriakatuete.firebasestorage.app",
  messagingSenderId: "731854540102",
  appId:             "1:731854540102:web:ee7f398a7580f0500f6947",
  measurementId:     "G-R9FSW6MB7H"
};

// =====================================
// ESTADO GLOBAL
// =====================================
let db           = null;   // Instancia Firestore
let useFirebase  = false;  // Flag Firebase disponible
let clientes     = [];     // Cache local
let productos    = [];
let ventas       = [];
let cart         = [];     // Carrito de venta actual
let confirmCb    = null;   // Callback confirmación

// Instancias Chart.js
const charts = {};

// =====================================
// FIREBASE: INICIO
// =====================================

/**
 * Inicializa Firebase. Si falla, activa modo localStorage.
 */
async function initFirebase() {
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.firestore();
    // Habilitar cache offline
    await db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    useFirebase = true;
    setBadge(true);
  } catch (err) {
    console.warn('Firebase no disponible. Usando localStorage:', err.message);
    useFirebase = false;
    setBadge(false);
  }
}

/** Actualiza el ícono de estado Firebase en el sidebar */
function setBadge(connected) {
  const dot  = document.getElementById('status-dot');
  const txt  = document.getElementById('firebase-txt');
  const wrap = document.getElementById('firebase-badge');
  if (connected) {
    dot.className  = 'status-dot';
    txt.textContent = 'Firebase';
    wrap.className = 'firebase-badge connected';
  } else {
    dot.className  = 'status-dot offline';
    txt.textContent = 'Local';
    wrap.className = 'firebase-badge local';
  }
}

// =====================================
// BASE DE DATOS UNIFICADA
// =====================================

/** Almacenamiento localStorage */
const LocalDB = {
  get(col)         { try { return JSON.parse(localStorage.getItem('imp_' + col)) || []; } catch { return []; } },
  save(col, data)  { localStorage.setItem('imp_' + col, JSON.stringify(data)); },
  uid()            { return Date.now().toString(36) + Math.random().toString(36).slice(2, 9); }
};

/** API unificada: usa Firebase o localStorage transparentemente */
const DB = {

  async add(col, data) {
    if (useFirebase) {
      const ref = await db.collection(col).add({
        ...data,
        fechaRegistro: firebase.firestore.FieldValue.serverTimestamp()
      });
      return ref.id;
    }
    const id   = LocalDB.uid();
    const list = LocalDB.get(col);
    list.unshift({ id, fechaRegistro: new Date().toISOString(), ...data });
    LocalDB.save(col, list);
    return id;
  },

  async update(col, id, data) {
    if (useFirebase) {
      await db.collection(col).doc(id).update(data);
      return;
    }
    const list = LocalDB.get(col);
    const idx  = list.findIndex(x => x.id === id);
    if (idx !== -1) list[idx] = { ...list[idx], ...data };
    LocalDB.save(col, list);
  },

  async delete(col, id) {
    if (useFirebase) {
      await db.collection(col).doc(id).delete();
      return;
    }
    LocalDB.save(col, LocalDB.get(col).filter(x => x.id !== id));
  },

  async getAll(col) {
    if (useFirebase) {
      const snap = await db.collection(col)
        .orderBy('fechaRegistro', 'desc')
        .get();
      return snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          fechaRegistro: data.fechaRegistro?.toDate?.()?.toISOString()
                       ?? new Date().toISOString()
        };
      });
    }
    return LocalDB.get(col);
  }
};

// =====================================
// NAVEGACIÓN
// =====================================

/** Cambia la sección activa */
function navigateTo(section) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const el  = document.getElementById('section-' + section);
  const nav = document.querySelector('.nav-item[data-section="' + section + '"]');
  if (el)  el.classList.add('active');
  if (nav) nav.classList.add('active');

  const titles = {
    dashboard: 'Dashboard',
    clientes:  'Gestión de Clientes',
    productos: 'Gestión de Productos',
    ventas:    'Registro de Ventas',
    informes:  'Informes y Análisis'
  };
  document.getElementById('page-title').textContent = titles[section] || section;

  // Cargar datos según sección
  switch (section) {
    case 'dashboard': loadDashboard();  break;
    case 'clientes':  renderClientes(); break;
    case 'productos': renderProductos(); break;
    case 'ventas':
      fillClienteSelect();
      fillProdSelect();
      renderHistorial();
      break;
    case 'informes': loadInformes(); break;
  }
}

// =====================================
// CARGA GENERAL DE DATOS
// =====================================

async function loadAll() {
  try {
    [clientes, productos, ventas] = await Promise.all([
      DB.getAll('clientes'),
      DB.getAll('productos'),
      DB.getAll('ventas')
    ]);
  } catch (e) {
    console.error('Error al cargar datos:', e);
    toast('Error al cargar datos del servidor', 'error');
  }
}

// =====================================
// DASHBOARD
// =====================================

async function loadDashboard() {
  await loadAll();
  renderMetrics();
  renderChart7d();
  renderRecents();
}

/** Renderiza las 4 tarjetas de métricas */
function renderMetrics() {
  // Total clientes
  animNum('m-clientes', clientes.length);

  // Ventas del mes actual
  const now  = new Date();
  const mes  = now.getMonth();
  const anio = now.getFullYear();
  const ventasMes = ventas.filter(v => {
    const d = new Date(v.fecha || v.fechaRegistro);
    return d.getMonth() === mes && d.getFullYear() === anio;
  });
  const totalMes = ventasMes.reduce((s, v) => s + (v.total || 0), 0);
  document.getElementById('m-ventas-mes').textContent = fmtMoney(totalMes);

  // Cliente mayor compra
  if (clientes.length > 0) {
    const top = [...clientes].sort((a, b) => (b.precioTotal || 0) - (a.precioTotal || 0))[0];
    document.getElementById('m-top-cliente').textContent = top.nombre;
    document.getElementById('m-top-cliente-val').textContent = fmtMoney(top.precioTotal || 0);
  }

  // Producto más vendido (de ventas registradas)
  const cnt = {};
  ventas.forEach(v => (v.productos || []).forEach(p => {
    cnt[p.nombre] = (cnt[p.nombre] || 0) + (p.cantidad || 1);
  }));
  const entries = Object.entries(cnt);
  if (entries.length > 0) {
    const [nombre, qty] = entries.sort((a, b) => b[1] - a[1])[0];
    document.getElementById('m-top-prod').textContent = nombre;
    document.getElementById('m-top-prod-qty').textContent = qty + ' unidades vendidas';
  }
}

/** Gráfico de ventas últimos 7 días */
function renderChart7d() {
  const ctx = document.getElementById('chart-ventas7d');
  if (!ctx) return;
  destroyChart('ventas7d');

  const labels = [], data = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    labels.push(d.toLocaleDateString('es-PY', { weekday: 'short', day: 'numeric' }));
    const total = ventas
      .filter(v => new Date(v.fecha || v.fechaRegistro).toDateString() === d.toDateString())
      .reduce((s, v) => s + (v.total || 0), 0);
    data.push(total);
  }

  charts['ventas7d'] = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Ventas ($)',
        data,
        borderColor: '#FFCC00',
        backgroundColor: 'rgba(255,204,0,0.10)',
        borderWidth: 2.5,
        fill: true,
        tension: 0.45,
        pointBackgroundColor: '#FFCC00',
        pointBorderColor: '#000',
        pointRadius: 5,
        pointHoverRadius: 8
      }]
    },
    options: chartOpts({ yPrefix: '$' })
  });
}

/** Últimos 5 clientes agregados */
function renderRecents() {
  const el = document.getElementById('recents-list');
  const list = [...clientes]
    .sort((a, b) => new Date(b.fechaRegistro) - new Date(a.fechaRegistro))
    .slice(0, 5);

  if (!list.length) {
    el.innerHTML = '<p class="empty-txt">No hay clientes registrados aún.</p>';
    return;
  }
  el.innerHTML = list.map(c => `
    <div class="recent-item">
      <div class="avatar sm">${initials(c.nombre)}</div>
      <div class="recent-info">
        <div class="recent-name">${esc(c.nombre)}</div>
        <div class="recent-sub">${esc(c.telefono || c.email || 'Sin contacto')}</div>
      </div>
      <div class="recent-val">${fmtMoney(c.precioTotal || 0)}</div>
    </div>
  `).join('');
}

// =====================================
// CLIENTES — CRUD
// =====================================

/** Abre el modal para agregar o editar un cliente */
function openClienteModal(id = null) {
  const form = document.getElementById('form-cliente');
  form.reset();
  document.getElementById('mc-id').value = '';
  document.querySelectorAll('[name="etiqueta"]').forEach(cb => cb.checked = false);

  if (id) {
    const c = clientes.find(x => x.id === id);
    if (!c) return;
    document.getElementById('mc-title').innerHTML = '<i class="fas fa-user-edit" style="color:var(--clr-primary)"></i> Editar Cliente';
    document.getElementById('mc-id').value        = c.id;
    document.getElementById('mc-nombre').value    = c.nombre || '';
    document.getElementById('mc-telefono').value  = c.telefono || '';
    document.getElementById('mc-email').value     = c.email || '';
    document.getElementById('mc-productos').value = Array.isArray(c.productos) ? c.productos.join(', ') : (c.productos || '');
    document.getElementById('mc-precio').value    = c.precioTotal || '';
    document.getElementById('mc-como').value      = c.comoConocio || '';
    (c.etiquetas || []).forEach(e => {
      const cb = document.querySelector(`[name="etiqueta"][value="${e}"]`);
      if (cb) cb.checked = true;
    });
  } else {
    document.getElementById('mc-title').innerHTML = '<i class="fas fa-user-plus" style="color:var(--clr-primary)"></i> Agregar Cliente';
  }

  document.getElementById('modal-cliente').style.display = 'flex';
}

function closeClienteModal() {
  document.getElementById('modal-cliente').style.display = 'none';
}

/** Maneja el submit del formulario de cliente */
async function handleClienteSubmit(e) {
  e.preventDefault();

  const id     = document.getElementById('mc-id').value;
  const nombre = document.getElementById('mc-nombre').value.trim();
  const email  = document.getElementById('mc-email').value.trim();

  if (!nombre) { toast('El nombre es obligatorio', 'error'); return; }
  if (email && !validEmail(email)) { toast('Email no válido', 'error'); return; }

  const prodsRaw  = document.getElementById('mc-productos').value.trim();
  const prodsArr  = prodsRaw ? prodsRaw.split(',').map(p => p.trim()).filter(Boolean) : [];
  let   etiquetas = [...document.querySelectorAll('[name="etiqueta"]:checked')].map(cb => cb.value);
  const precio    = parseFloat(document.getElementById('mc-precio').value) || 0;

  // Auto-VIP si supera $500
  if (precio > 500 && !etiquetas.includes('VIP')) etiquetas.push('VIP');

  const data = {
    nombre,
    telefono:    document.getElementById('mc-telefono').value.trim(),
    email,
    productos:   prodsArr,
    precioTotal: precio,
    comoConocio: document.getElementById('mc-como').value,
    etiquetas,
    ultimaCompra: new Date().toISOString()
  };

  const btn = document.getElementById('mc-submit-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';

  try {
    if (id) {
      await DB.update('clientes', id, data);
      toast('Cliente actualizado correctamente', 'success');
    } else {
      await DB.add('clientes', data);
      toast('Cliente agregado correctamente', 'success');
    }
    closeClienteModal();
    await loadAll();
    renderClientes();
  } catch (err) {
    console.error(err);
    toast('Error al guardar el cliente', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save"></i> Guardar Cliente';
  }
}

/** Renderiza la tabla de clientes con filtros activos */
function renderClientes() { applyFilters(); }

/** Aplica todos los filtros y actualiza la tabla */
function applyFilters() {
  let list = [...clientes];

  const buscar = (document.getElementById('f-buscar')?.value || '').toLowerCase();
  const etiq   = document.getElementById('f-etiqueta')?.value || '';
  const canal  = document.getElementById('f-canal')?.value || '';
  const orden  = document.getElementById('f-orden')?.value || 'nombre';
  const min    = parseFloat(document.getElementById('f-min')?.value) || 0;
  const max    = parseFloat(document.getElementById('f-max')?.value) || Infinity;

  if (buscar) list = list.filter(c =>
    (c.nombre    || '').toLowerCase().includes(buscar) ||
    (c.telefono  || '').toLowerCase().includes(buscar) ||
    (c.email     || '').toLowerCase().includes(buscar)
  );
  if (etiq) list = list.filter(c => (c.etiquetas || []).includes(etiq));
  if (canal) list = list.filter(c => c.comoConocio === canal);
  if (min)   list = list.filter(c => (c.precioTotal || 0) >= min);
  if (max < Infinity) list = list.filter(c => (c.precioTotal || 0) <= max);

  list.sort((a, b) => {
    if (orden === 'nombre') return (a.nombre || '').localeCompare(b.nombre || '');
    if (orden === 'fecha')  return new Date(b.fechaRegistro) - new Date(a.fechaRegistro);
    if (orden === 'precio') return (b.precioTotal || 0) - (a.precioTotal || 0);
    return 0;
  });

  renderClientesTable(list);
}

function renderClientesTable(list) {
  const tbody = document.getElementById('cli-tbody');
  const empty = document.getElementById('cli-empty');
  document.getElementById('cli-count').textContent = `${list.length} cliente${list.length !== 1 ? 's' : ''}`;

  if (!list.length) {
    tbody.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = list.map(c => `
    <tr>
      <td>
        <div class="td-name">
          <div class="avatar sm">${initials(c.nombre)}</div>
          <div>
            <div style="font-weight:700">${esc(c.nombre)}</div>
            <div style="font-size:.72rem;color:var(--txt-3)">${fmtDate(c.fechaRegistro)}</div>
          </div>
        </div>
      </td>
      <td>
        <div style="font-weight:500">${esc(c.telefono || '—')}</div>
        <div style="font-size:.73rem;color:var(--txt-3)">${esc(c.email || '—')}</div>
      </td>
      <td style="font-family:'Montserrat',sans-serif;font-weight:800;color:var(--clr-primary)">
        ${fmtMoney(c.precioTotal || 0)}
      </td>
      <td>
        <div style="display:flex;flex-wrap:wrap;gap:3px">
          ${(c.etiquetas || []).map(e => `<span class="badge ${badgeClass(e)}">${esc(e)}</span>`).join('')}
        </div>
      </td>
      <td style="font-size:.8rem;color:var(--txt-2)">${esc(c.comoConocio || '—')}</td>
      <td style="font-size:.78rem;color:var(--txt-3)">${fmtDate(c.fechaRegistro)}</td>
      <td>
        <div class="tbl-acts">
          <button class="icon-btn edit" onclick="openClienteModal('${c.id}')" title="Editar">
            <i class="fas fa-edit"></i>
          </button>
          <button class="icon-btn whatsapp" onclick="sendWhatsApp('${c.id}')" title="WhatsApp">
            <i class="fab fa-whatsapp"></i>
          </button>
          <button class="icon-btn del" onclick="confirmDelCliente('${c.id}')" title="Eliminar">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

function clearFilters() {
  ['f-buscar','f-etiqueta','f-canal','f-min','f-max'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const orden = document.getElementById('f-orden');
  if (orden) orden.value = 'nombre';
  applyFilters();
}

function confirmDelCliente(id) {
  const c = clientes.find(x => x.id === id);
  if (!c) return;
  openConfirmModal(`¿Eliminar a "${c.nombre}"?`, 'Esta acción no se puede deshacer.', async () => {
    try {
      await DB.delete('clientes', id);
      toast('Cliente eliminado', 'success');
      await loadAll();
      renderClientes();
    } catch { toast('Error al eliminar', 'error'); }
  });
}

// =====================================
// EXPORTAR CSV
// =====================================

function exportClientesCSV() {
  if (!clientes.length) { toast('No hay clientes para exportar', 'warning'); return; }
  const headers = ['Nombre','Teléfono','Email','Productos','Compra Total ($)','Cómo Conoció','Etiquetas','Fecha'];
  const rows = clientes.map(c => [
    c.nombre || '',
    c.telefono || '',
    c.email || '',
    (Array.isArray(c.productos) ? c.productos : [c.productos || '']).join(' | '),
    c.precioTotal || 0,
    c.comoConocio || '',
    (c.etiquetas || []).join(' | '),
    fmtDate(c.fechaRegistro)
  ]);
  downloadCSV(headers, rows, 'clientes_imperio');
  toast('CSV de clientes exportado', 'success');
}

function exportVentasCSV() {
  if (!ventas.length) { toast('No hay ventas para exportar', 'warning'); return; }
  const headers = ['Cliente','Productos','Total ($)','Fecha'];
  const rows = ventas.map(v => [
    v.clienteNombre || '',
    (v.productos || []).map(p => `${p.nombre} x${p.cantidad}`).join(' | '),
    v.total || 0,
    fmtDate(v.fecha || v.fechaRegistro)
  ]);
  downloadCSV(headers, rows, 'ventas_imperio');
  toast('CSV de ventas exportado', 'success');
}

// =====================================
// PRODUCTOS — CRUD
// =====================================

function openProductoModal(id = null) {
  document.getElementById('form-producto').reset();
  document.getElementById('mp-id').value = '';

  if (id) {
    const p = productos.find(x => x.id === id);
    if (!p) return;
    document.getElementById('mp-title').innerHTML = '<i class="fas fa-box-open" style="color:var(--clr-primary)"></i> Editar Producto';
    document.getElementById('mp-id').value         = p.id;
    document.getElementById('mp-nombre').value     = p.nombre || '';
    document.getElementById('mp-categoria').value  = p.categoria || '';
    document.getElementById('mp-precio').value     = p.precio || '';
    document.getElementById('mp-stock').value      = p.stock || '';
  } else {
    document.getElementById('mp-title').innerHTML = '<i class="fas fa-box" style="color:var(--clr-primary)"></i> Agregar Producto';
  }

  document.getElementById('modal-producto').style.display = 'flex';
}

function closeProductoModal() {
  document.getElementById('modal-producto').style.display = 'none';
}

async function handleProductoSubmit(e) {
  e.preventDefault();

  const id     = document.getElementById('mp-id').value;
  const nombre = document.getElementById('mp-nombre').value.trim();
  if (!nombre) { toast('El nombre es obligatorio', 'error'); return; }

  const data = {
    nombre,
    categoria: document.getElementById('mp-categoria').value,
    precio:    parseFloat(document.getElementById('mp-precio').value) || 0,
    stock:     parseInt(document.getElementById('mp-stock').value) || 0
  };

  try {
    if (id) {
      await DB.update('productos', id, data);
      toast('Producto actualizado', 'success');
    } else {
      await DB.add('productos', data);
      toast('Producto agregado', 'success');
    }
    closeProductoModal();
    await loadAll();
    renderProductos();
  } catch (err) {
    console.error(err);
    toast('Error al guardar el producto', 'error');
  }
}

/** Renderiza la grilla de productos */
function renderProductos() {
  const buscar = (document.getElementById('p-buscar')?.value || '').toLowerCase();
  const cat    = document.getElementById('p-cat')?.value || '';

  let list = [...productos];
  if (buscar) list = list.filter(p => (p.nombre || '').toLowerCase().includes(buscar));
  if (cat)    list = list.filter(p => p.categoria === cat);

  const grid  = document.getElementById('prods-grid');
  const empty = document.getElementById('prods-empty');

  if (!list.length) { grid.innerHTML = ''; empty.style.display = 'flex'; return; }
  empty.style.display = 'none';

  grid.innerHTML = list.map(p => `
    <div class="glass-card prod-card">
      <div class="prod-icon"><i class="${catIcon(p.categoria)}"></i></div>
      <div>
        <div class="prod-name">${esc(p.nombre)}</div>
        <div class="prod-cat">${esc(p.categoria || 'Sin categoría')}</div>
      </div>
      <div class="prod-row">
        <div class="prod-price">${fmtMoney(p.precio || 0)}</div>
        <span class="stock-badge ${stockClass(p.stock)}">${p.stock} en stock</span>
      </div>
      <div class="prod-acts">
        <button class="btn btn-sm btn-outline" style="flex:1" onclick="openProductoModal('${p.id}')">
          <i class="fas fa-edit"></i> Editar
        </button>
        <button class="icon-btn del" onclick="confirmDelProducto('${p.id}')" title="Eliminar">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>
  `).join('');
}

function confirmDelProducto(id) {
  const p = productos.find(x => x.id === id);
  if (!p) return;
  openConfirmModal(`¿Eliminar "${p.nombre}"?`, 'Esta acción no se puede deshacer.', async () => {
    try {
      await DB.delete('productos', id);
      toast('Producto eliminado', 'success');
      await loadAll();
      renderProductos();
    } catch { toast('Error al eliminar', 'error'); }
  });
}

// =====================================
// VENTAS
// =====================================

function fillClienteSelect() {
  const sel = document.getElementById('v-cliente');
  sel.innerHTML = '<option value="">-- Seleccionar cliente --</option>';
  [...clientes].sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '')).forEach(c => {
    sel.innerHTML += `<option value="${c.id}">${esc(c.nombre)}</option>`;
  });
}

function fillProdSelect() {
  const sel = document.getElementById('v-prod-sel');
  sel.innerHTML = '<option value="">-- Producto --</option>';
  productos.forEach(p => {
    sel.innerHTML += `<option value="${p.id}" data-precio="${p.precio}" data-nombre="${esc(p.nombre)}">${esc(p.nombre)} — ${fmtMoney(p.precio)}</option>`;
  });
}

/** Muestra preview del cliente seleccionado y sugerencias IA */
function onClienteChange() {
  const id      = document.getElementById('v-cliente').value;
  const preview = document.getElementById('v-preview');
  const vipBadge = document.getElementById('v-vip-badge');

  if (!id) { preview.style.display = 'none'; hideAI(); return; }

  const c = clientes.find(x => x.id === id);
  if (!c) return;

  document.getElementById('v-prev-name').textContent = c.nombre;
  document.getElementById('v-prev-sub').textContent  = c.email || c.telefono || '';
  preview.style.display = 'flex';

  const isVip = (c.precioTotal || 0) > 500 || (c.etiquetas || []).includes('VIP');
  vipBadge.style.display = isVip ? 'flex' : 'none';

  showAISugg(c);
}

/** Sugerencias inteligentes basadas en historial del cliente */
function showAISugg(cliente) {
  const MAP = {
    'taladro'   : ['Brocas para metal', 'Brocas para madera', 'Extensión eléctrica'],
    'pintura'   : ['Rodillo', 'Brocha', 'Aguarrás', 'Cinta de enmascarar'],
    'tornillo'  : ['Taco Fisher', 'Destornillador', 'Pistola de impacto'],
    'tubo'      : ['Codo PVC', 'Pegamento PVC', 'Llave de paso'],
    'cable'     : ['Cinta aislante', 'Disyuntor', 'Toma corriente'],
    'sierra'    : ['Hoja de sierra', 'Guantes de seguridad', 'Gafas de protección'],
    'cemento'   : ['Arena fina', 'Cal', 'Llana', 'Nivel de burbuja'],
    'llave'     : ['Llave inglesa', 'Alicate universal', 'Juego de llaves'],
    'esmeril'   : ['Disco de corte', 'Disco de desbaste', 'Guantes de cuero'],
    'compresor' : ['Pistola de pintura', 'Manguera de aire', 'Accesorios neumáticos']
  };

  const prodsTexto = (Array.isArray(cliente.productos) ? cliente.productos : []).join(' ').toLowerCase();
  const suggs = [];

  Object.entries(MAP).forEach(([key, items]) => {
    if (prodsTexto.includes(key)) {
      items.forEach(s => {
        if (!prodsTexto.includes(s.toLowerCase()) && !suggs.includes(s))
          suggs.push(s);
      });
    }
  });

  if (suggs.length > 0) {
    document.getElementById('ai-chips').innerHTML = suggs.slice(0, 6).map(s => `
      <span class="ai-chip" onclick="addSuggToCart('${esc(s)}')">
        <i class="fas fa-plus-circle"></i> ${esc(s)}
      </span>
    `).join('');
    document.getElementById('ai-box').style.display = 'block';
  } else {
    hideAI();
  }
}

function hideAI() { document.getElementById('ai-box').style.display = 'none'; }

function addSuggToCart(nombre) {
  const prod = productos.find(p => p.nombre.toLowerCase().includes(nombre.toLowerCase()));
  if (prod) {
    document.getElementById('v-prod-sel').value = prod.id;
    addToCart();
  } else {
    toast(`"${nombre}" no está en el catálogo`, 'info');
  }
}

/** Agrega un producto al carrito */
function addToCart() {
  const sel  = document.getElementById('v-prod-sel');
  const id   = sel.value;
  const qty  = parseInt(document.getElementById('v-qty').value) || 1;
  if (!id) { toast('Selecciona un producto', 'warning'); return; }

  const prod = productos.find(p => p.id === id);
  if (!prod) return;

  const exists = cart.find(x => x.id === id);
  if (exists) {
    exists.cantidad += qty;
  } else {
    cart.push({ id: prod.id, nombre: prod.nombre, precio: prod.precio || 0, cantidad: qty });
  }

  sel.value = '';
  document.getElementById('v-qty').value = 1;
  renderCart();
}

function removeFromCart(id) {
  cart = cart.filter(x => x.id !== id);
  renderCart();
}

function renderCart() {
  const el    = document.getElementById('cart-list');
  const total = cart.reduce((s, p) => s + p.precio * p.cantidad, 0);
  document.getElementById('v-total').textContent = fmtMoney(total);

  if (!cart.length) {
    el.innerHTML = '<p style="font-size:.78rem;color:var(--txt-3);text-align:center;padding:8px">Carrito vacío — agrega productos</p>';
    return;
  }
  el.innerHTML = cart.map(p => `
    <div class="cart-item">
      <div class="cart-item-info">
        <div class="cart-item-name">${esc(p.nombre)}</div>
        <div class="cart-item-meta">${p.cantidad} × ${fmtMoney(p.precio)}</div>
      </div>
      <span class="cart-item-price">${fmtMoney(p.precio * p.cantidad)}</span>
      <button class="icon-btn del" onclick="removeFromCart('${p.id}')" title="Quitar">
        <i class="fas fa-times"></i>
      </button>
    </div>
  `).join('');
}

async function handleVentaSubmit(e) {
  e.preventDefault();

  const clienteId = document.getElementById('v-cliente').value;
  if (!clienteId) { toast('Selecciona un cliente', 'error'); return; }
  if (!cart.length) { toast('Agrega al menos un producto', 'error'); return; }

  const cliente = clientes.find(x => x.id === clienteId);
  const total   = cart.reduce((s, p) => s + p.precio * p.cantidad, 0);

  const ventaData = {
    clienteId,
    clienteNombre: cliente?.nombre || 'Desconocido',
    productos: cart.map(p => ({ ...p })),
    total,
    fecha: new Date().toISOString()
  };

  try {
    await DB.add('ventas', ventaData);

    // Actualizar totales del cliente
    const prevProds  = Array.isArray(cliente?.productos) ? cliente.productos : [];
    const newProds   = [...new Set([...prevProds, ...cart.map(p => p.nombre)])];
    const newTotal   = (cliente?.precioTotal || 0) + total;
    const etiquetas  = [...(cliente?.etiquetas || [])];
    if (newTotal > 500 && !etiquetas.includes('VIP')) etiquetas.push('VIP');

    await DB.update('clientes', clienteId, {
      productos: newProds,
      precioTotal: newTotal,
      etiquetas,
      ultimaCompra: new Date().toISOString()
    });

    toast(`Venta de ${fmtMoney(total)} registrada exitosamente`, 'success');
    clearVenta();
    await loadAll();
    renderHistorial();
    fillClienteSelect();
  } catch (err) {
    console.error(err);
    toast('Error al registrar la venta', 'error');
  }
}

function clearVenta() {
  document.getElementById('form-venta').reset();
  cart = [];
  renderCart();
  document.getElementById('v-preview').style.display = 'none';
  hideAI();
}

function renderHistorial() {
  const el = document.getElementById('hist-list');
  if (!ventas.length) {
    el.innerHTML = '<div class="empty-box"><i class="fas fa-shopping-cart"></i><p>No hay ventas registradas aún.</p></div>';
    return;
  }
  const sorted = [...ventas].sort((a, b) =>
    new Date(b.fecha || b.fechaRegistro) - new Date(a.fecha || a.fechaRegistro)
  );
  el.innerHTML = sorted.map(v => `
    <div class="hist-item">
      <div class="hist-hdr">
        <div>
          <div class="hist-client"><i class="fas fa-user" style="color:var(--clr-primary)"></i> ${esc(v.clienteNombre || 'Cliente')}</div>
          <div class="hist-date">${fmtDateTime(v.fecha || v.fechaRegistro)}</div>
        </div>
        <div class="hist-amt">${fmtMoney(v.total || 0)}</div>
      </div>
      <div class="hist-prods">${(v.productos || []).map(p => `${esc(p.nombre)} ×${p.cantidad}`).join(' · ')}</div>
    </div>
  `).join('');
}

// =====================================
// INFORMES
// =====================================

async function loadInformes() {
  await loadAll();
  renderChartCanal();
  renderChartProds();
  renderChartTipos();
  renderChartTendencia();
  renderVIPList();
}

function renderChartCanal() {
  const ctx = document.getElementById('chart-canal');
  if (!ctx) return;
  destroyChart('canal');

  const cnt = {};
  clientes.forEach(c => { const k = c.comoConocio || 'Sin especificar'; cnt[k] = (cnt[k] || 0) + 1; });

  charts['canal'] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: Object.keys(cnt),
      datasets: [{ data: Object.values(cnt), backgroundColor: PIE_COLORS, borderWidth: 0 }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: legendOpts(), tooltip: tooltipOpts() } }
  });
}

function renderChartProds() {
  const ctx = document.getElementById('chart-prods');
  if (!ctx) return;
  destroyChart('prods');

  const cnt = {};
  ventas.forEach(v => (v.productos || []).forEach(p => { cnt[p.nombre] = (cnt[p.nombre] || 0) + (p.cantidad || 1); }));
  const sorted = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 8);

  charts['prods'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(([k]) => k),
      datasets: [{ label: 'Unidades', data: sorted.map(([, v]) => v), backgroundColor: 'rgba(255,204,0,.75)', borderRadius: 6, borderWidth: 0 }]
    },
    options: { ...chartOpts(), indexAxis: 'y', plugins: { legend: { display: false }, tooltip: tooltipOpts() } }
  });
}

function renderChartTipos() {
  const ctx = document.getElementById('chart-tipos');
  if (!ctx) return;
  destroyChart('tipos');

  const cnt = {};
  clientes.forEach(c => (c.etiquetas || []).forEach(e => { cnt[e] = (cnt[e] || 0) + 1; }));
  const sorted = Object.entries(cnt).sort((a, b) => b[1] - a[1]);

  charts['tipos'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(([k]) => k),
      datasets: [{ label: 'Clientes', data: sorted.map(([, v]) => v), backgroundColor: PIE_COLORS, borderRadius: 6, borderWidth: 0 }]
    },
    options: { ...chartOpts(), plugins: { legend: { display: false }, tooltip: tooltipOpts() } }
  });
}

function renderChartTendencia() {
  const ctx = document.getElementById('chart-tendencia');
  if (!ctx) return;
  destroyChart('tendencia');

  const semanas = [];
  const totales = [];
  for (let i = 3; i >= 0; i--) {
    const fin    = new Date(); fin.setDate(fin.getDate() - i * 7);
    const inicio = new Date(fin); inicio.setDate(fin.getDate() - 6);
    semanas.push(i === 0 ? 'Esta semana' : `Hace ${i} sem.`);
    totales.push(
      ventas.filter(v => {
        const d = new Date(v.fecha || v.fechaRegistro);
        return d >= inicio && d <= fin;
      }).reduce((s, v) => s + (v.total || 0), 0)
    );
  }

  charts['tendencia'] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: semanas,
      datasets: [{
        label: 'Ingresos ($)',
        data: totales,
        borderColor: '#4CAF50',
        backgroundColor: 'rgba(76,175,80,.10)',
        fill: true, tension: 0.4,
        pointBackgroundColor: '#4CAF50',
        pointRadius: 5, borderWidth: 2.5
      }]
    },
    options: chartOpts({ yPrefix: '$' })
  });
}

function renderVIPList() {
  const el   = document.getElementById('vip-grid');
  const vips = clientes.filter(c => (c.precioTotal || 0) > 500 || (c.etiquetas || []).includes('VIP'))
                       .sort((a, b) => (b.precioTotal || 0) - (a.precioTotal || 0));

  if (!vips.length) { el.innerHTML = '<p class="empty-txt">No hay clientes VIP aún. (Compra total > $500)</p>'; return; }

  el.innerHTML = vips.map(c => `
    <div class="vip-item">
      <i class="fas fa-crown vip-crown"></i>
      <div>
        <div class="vip-name">${esc(c.nombre)}</div>
        <div class="vip-total">${fmtMoney(c.precioTotal || 0)}</div>
      </div>
    </div>
  `).join('');
}

// =====================================
// IA: WHATSAPP
// =====================================

/** Genera y abre un mensaje de WhatsApp personalizado */
function sendWhatsApp(id) {
  const c = clientes.find(x => x.id === id);
  if (!c) return;

  const tel    = (c.telefono || '').replace(/\D/g, '');
  const isVip  = (c.precioTotal || 0) > 500 || (c.etiquetas || []).includes('VIP');
  const prods  = Array.isArray(c.productos) ? c.productos.slice(0, 2).join(' y ') : '';
  const nombre = c.nombre.split(' ')[0]; // Primer nombre

  let msg = `¡Hola ${nombre}! 👋\n\n`;
  msg += `Te contactamos desde *IMPERIO FERRETERÍA* 🔨\n\n`;

  if (isVip) {
    msg += `Como cliente *VIP*, queremos agradecerte tu confianza y lealtad. 🌟\n`;
    msg += `Tenemos ofertas exclusivas preparadas para ti.\n\n`;
  } else {
    msg += `Gracias por elegirnos para tus proyectos. 🏗️\n\n`;
  }

  if (prods) msg += `Esperamos que ${prods} estén siendo de gran ayuda.\n\n`;

  msg += `¿Necesitas algo más? Tenemos todo en herramientas, materiales y más. 🛠️\n`;
  msg += `¡Escríbenos o visítanos, estamos para servirte!\n\n`;
  msg += `— Equipo *IMPERIO FERRETERÍA* 🏪`;

  const url = `https://wa.me/${tel || ''}?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
}

// =====================================
// MODAL CONFIRMAR
// =====================================

function openConfirmModal(title, message, cb) {
  document.getElementById('conf-title').textContent = title;
  document.getElementById('conf-msg').textContent   = message;
  confirmCb = cb;
  document.getElementById('modal-confirm').style.display = 'flex';
}

function closeConfirmModal() {
  document.getElementById('modal-confirm').style.display = 'none';
  confirmCb = null;
}

function execConfirm() {
  if (confirmCb) { confirmCb(); closeConfirmModal(); }
}

// =====================================
// TOASTS
// =====================================

function toast(msg, type = 'info') {
  const ico = { success: 'fa-check-circle', error: 'fa-times-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
  const div = document.createElement('div');
  div.className = `toast ${type}`;
  div.innerHTML = `<i class="toast-ico fas ${ico[type] || ico.info}"></i><span>${esc(msg)}</span>`;
  document.getElementById('toast-container').appendChild(div);
  setTimeout(() => { div.classList.add('out'); setTimeout(() => div.remove(), 300); }, 3500);
}

// =====================================
// UTILIDADES
// =====================================

/** Formatea dinero con símbolo $ */
function fmtMoney(n) {
  return '$' + parseFloat(n || 0).toLocaleString('es-PY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(str) {
  if (!str) return '—';
  try { return new Date(str).toLocaleDateString('es-PY', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
  catch { return '—'; }
}

function fmtDateTime(str) {
  if (!str) return '—';
  try { return new Date(str).toLocaleString('es-PY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return '—'; }
}

function initials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

function badgeClass(tag) {
  const m = {
    'VIP':'b-vip','Profesional':'b-prof','Constructor':'b-cons',
    'Empresa':'b-emp','DIY (Hágalo usted mismo)':'b-diy',
    'Cliente Recurrente':'b-rec','Nuevo':'b-new'
  };
  return m[tag] || 'b-def';
}

function catIcon(cat) {
  const m = {
    'Herramientas Eléctricas':'fas fa-plug',
    'Herramientas Manuales':'fas fa-hammer',
    'Pinturas y Acabados':'fas fa-paint-roller',
    'Fontanería':'fas fa-faucet',
    'Material Eléctrico':'fas fa-bolt',
    'Ferretería en General':'fas fa-tools',
    'Otros':'fas fa-box'
  };
  return m[cat] || 'fas fa-box';
}

function stockClass(n) {
  if (!n || n <= 0) return 'stock-out';
  if (n <= 5)       return 'stock-low';
  return 'stock-ok';
}

function downloadCSV(headers, rows, name) {
  const BOM = '\uFEFF';
  const csv = [headers.join(';'), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(';'))].join('\n');
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `${name}_${new Date().toLocaleDateString('es-PY').replace(/\//g,'-')}.csv`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

function animNum(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  let n = 0;
  const step = Math.ceil(target / 25) || 1;
  const t = setInterval(() => {
    n = Math.min(n + step, target);
    el.textContent = n;
    if (n >= target) clearInterval(t);
  }, 35);
}

function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); delete charts[key]; }
}

// Opciones base de Chart.js
function chartOpts({ yPrefix = '' } = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(0,0,0,.82)',
        titleColor: '#FFCC00', bodyColor: '#fff',
        callbacks: { label: ctx => ` ${yPrefix}${ctx.parsed.y ?? ctx.parsed}` }
      }
    },
    scales: {
      x: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: 'rgba(255,255,255,.50)', font: { size: 11 } } },
      y: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: 'rgba(255,255,255,.50)', font: { size: 11 }, callback: v => yPrefix + v } }
    }
  };
}
function legendOpts() {
  return { position: 'bottom', labels: { color: 'rgba(255,255,255,.65)', font: { size: 11 }, padding: 14 } };
}
function tooltipOpts() {
  return { backgroundColor: 'rgba(0,0,0,.82)', titleColor: '#FFCC00', bodyColor: '#fff' };
}

const PIE_COLORS = [
  'rgba(255,204,0,.80)','rgba(33,150,243,.80)','rgba(76,175,80,.80)',
  'rgba(255,152,0,.80)','rgba(156,39,176,.80)','rgba(0,188,212,.80)',
  'rgba(255,68,68,.80)','rgba(103,58,183,.80)'
];

// =====================================
// INICIALIZACIÓN
// =====================================

async function init() {
  // Tema guardado
  const theme = localStorage.getItem('imp_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('theme-ico').className = theme === 'light' ? 'fas fa-sun' : 'fas fa-moon';

  // Fecha actual
  document.getElementById('current-date').textContent = new Date().toLocaleDateString('es-PY', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  // Firebase
  await initFirebase();

  // Datos
  await loadAll();

  // Navegación por sidebar
  document.querySelectorAll('.nav-item[data-section]').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(item.getAttribute('data-section'));
    });
  });

  // Formularios
  document.getElementById('form-cliente').addEventListener('submit', handleClienteSubmit);
  document.getElementById('form-producto').addEventListener('submit', handleProductoSubmit);
  document.getElementById('form-venta').addEventListener('submit', handleVentaSubmit);

  // Confirmar modal
  document.getElementById('conf-btn').addEventListener('click', execConfirm);

  // Sidebar toggle
  document.getElementById('btn-sidebar').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
  });

  // Tema toggle
  document.getElementById('btn-theme').addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const next   = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    document.getElementById('theme-ico').className = isDark ? 'fas fa-sun' : 'fas fa-moon';
    localStorage.setItem('imp_theme', next);
  });

  // Búsqueda global
  document.getElementById('global-search').addEventListener('input', e => {
    const q = e.target.value.trim();
    if (!q) return;
    navigateTo('clientes');
    const fb = document.getElementById('f-buscar');
    if (fb) { fb.value = q; applyFilters(); }
  });

  // Cerrar modales al hacer click fuera
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.style.display = 'none';
    });
  });

  // Dashboard inicial
  navigateTo('dashboard');

  // Ocultar pantalla de carga
  setTimeout(() => {
    const ls = document.getElementById('loading-screen');
    if (ls) { ls.classList.add('fade-out'); setTimeout(() => ls.remove(), 500); }
  }, 900);

  // Aviso modo offline
  if (!useFirebase) {
    setTimeout(() => toast('Usando almacenamiento local. Configura Firebase para sincronización en la nube.', 'warning'), 1200);
  }
}

// Arrancar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', init);

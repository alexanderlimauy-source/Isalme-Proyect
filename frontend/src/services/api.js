const API_HOST = typeof window !== "undefined" ? window.location.hostname : "localhost";
const API_URL = `http://${API_HOST}:3000/api`;

export async function obtenerProductos() {
  const respuesta = await fetch(`${API_URL}/productos`);

  if (!respuesta.ok) {
    throw new Error("No se pudieron obtener los productos");
  }

  return await respuesta.json();
}

async function enviarAuth(endpoint, datos) {
  const respuesta = await fetch(`${API_URL}/auth/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(datos)
  });
  const resultado = await respuesta.json();
  if (!respuesta.ok) throw new Error(resultado.error || "No se pudo completar la operación");
  return resultado;
}

export function iniciarSesion(datos) {
  return enviarAuth("login", datos);
}

export function registrarUsuario(datos) {
  return enviarAuth("register", datos);
}

export async function crearPedido(datos) {
  const { token, ...pedido } = datos;
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const respuesta = await fetch(`${API_URL}/pedidos`, {
    method: "POST",
    headers,
    body: JSON.stringify(pedido)
  });
  const resultado = await respuesta.json();
  if (!respuesta.ok) throw new Error(resultado.error || "No se pudo crear el pedido");
  return resultado.order;
}

async function adminFetch(path, token, options = {}) {
  const respuesta = await fetch(`${API_URL}/admin${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });
  const resultado = await respuesta.json();
  if (respuesta.status === 401 && typeof window !== "undefined") {
    localStorage.removeItem("u");
    if (window.location.hash === "#admin") window.location.hash = "ingresar";
  }
  if (!respuesta.ok) throw new Error(resultado.error || "No se pudo completar la operación administrativa");
  return resultado;
}

export function obtenerResumenAdmin(token) { return adminFetch("/resumen", token); }
export function obtenerClientesAdmin(token) { return adminFetch("/clientes", token); }
export function obtenerProveedoresAdmin(token) { return adminFetch("/proveedores", token); }
export function obtenerComprasAdmin(token) { return adminFetch("/compras", token); }
export function crearCompraAdmin(token, compra) { return adminFetch("/compras", token, { method: "POST", body: JSON.stringify(compra) }); }
export function actualizarCompraAdmin(token, id, compra) { return adminFetch(`/compras/${id}`, token, { method: "PATCH", body: JSON.stringify(compra) }); }
export function actualizarProductoCompraAdmin(token, idCompra, idProducto, datos) { return adminFetch(`/compras/${idCompra}/productos/${idProducto}`, token, { method: "PATCH", body: JSON.stringify(datos) }); }
export function borrarCompraAdmin(token, id) { return adminFetch(`/compras/${id}`, token, { method: "DELETE" }); }
export async function subirFacturaCompraAdmin(token, id, archivo) {
  const data = await new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(lector.result);
    lector.onerror = () => reject(new Error("No se pudo leer la factura"));
    lector.readAsDataURL(archivo);
  });
  const resultado = await adminFetch(`/compras/${id}/archivos`, token, { method: "POST", body: JSON.stringify({ archivo: { nombre: archivo.name, tipo: archivo.type, data } }) });
  window.dispatchEvent(new CustomEvent("factura-compra-subida", { detail: resultado }));
  return resultado;
}
export function borrarFacturaCompraAdmin(token, id, archivoId) { return adminFetch(`/compras/${id}/archivos/${archivoId}`, token, { method: "DELETE" }); }
export function crearProveedorAdmin(token, proveedor) { return adminFetch("/proveedores", token, { method: "POST", body: JSON.stringify(proveedor) }); }
export function actualizarProveedorAdmin(token, id, proveedor) { return adminFetch(`/proveedores/${id}`, token, { method: "PATCH", body: JSON.stringify(proveedor) }); }
export function cambiarEstadoProveedorAdmin(token, id, activo) { return adminFetch(`/proveedores/${id}/estado`, token, { method: "PATCH", body: JSON.stringify({ activo }) }); }
export function obtenerProductosAdmin(token) { return adminFetch("/productos", token); }
export function crearProductoAdmin(token, producto) { return adminFetch("/productos", token, { method: "POST", body: JSON.stringify(producto) }); }
export function actualizarProductoAdmin(token, id, datos) { return adminFetch(`/productos/${id}`, token, { method: "PATCH", body: JSON.stringify(datos) }); }
export function cambiarEstadoProductoAdmin(token, id, activo) { return adminFetch(`/productos/${id}/estado`, token, { method: "PATCH", body: JSON.stringify({ activo }) }); }
export function borrarProductoAdmin(token, id) { return adminFetch(`/productos/${id}`, token, { method: "DELETE" }); }
export function actualizarImagenesProductoAdmin(token, id, imagenes) { return adminFetch(`/productos/${id}/imagenes`, token, { method: "PUT", body: JSON.stringify({ imagenes }) }); }
export async function subirImagenesProductoAdmin(token, id, archivos, reemplazar = Boolean(window.__reemplazarImagenes)) {
  const imagenesConservar = Array.isArray(window.__imagenesConservar) ? window.__imagenesConservar : null;
  if (imagenesConservar) {
    const resultado = await actualizarImagenesProductoAdmin(token, id, imagenesConservar);
    reemplazar = false;
    window.__imagenesConservar = null;
    if (!archivos?.length) return resultado;
  }
  const imagenes = await Promise.all([...archivos].filter(Boolean).map(archivo => new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve({ nombre: archivo.name, tipo: archivo.type, data: lector.result });
    lector.onerror = () => reject(new Error("No se pudo leer una imagen"));
    lector.readAsDataURL(archivo);
  })));
  return adminFetch(`/productos/${id}/imagenes/upload`, token, { method: "POST", body: JSON.stringify({ imagenes, reemplazar }) });
}

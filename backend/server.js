const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const pool = require("./db");

const app = express();
const productUploadsDir = path.join(__dirname, "uploads", "productos");
const invoiceUploadsDir = path.join(__dirname, "uploads", "facturas");
fs.mkdirSync(productUploadsDir, { recursive: true });
fs.mkdirSync(invoiceUploadsDir, { recursive: true });

const localProductImagePath = imageUrl => {
  try {
    const pathname = new URL(String(imageUrl), "http://localhost").pathname;
    const uploadsPrefix = "/uploads/productos/";
    if (!pathname.startsWith(uploadsPrefix)) return null;
    const uploadsRoot = path.resolve(productUploadsDir);
    const imagePath = path.resolve(uploadsRoot, decodeURIComponent(pathname.slice(uploadsPrefix.length)));
    if (!imagePath.startsWith(`${uploadsRoot}${path.sep}`)) return null;
    return imagePath;
  } catch {
    return null;
  }
};

const productFolderName = id => String(id);

const productUploadDirectory = id => {
  const directory = path.join(productUploadsDir, productFolderName(id));
  fs.mkdirSync(directory, { recursive: true });
  return directory;
};

const removeProductUploadDirectory = id => {
  try {
    fs.rmSync(path.join(productUploadsDir, productFolderName(id)), { recursive: true, force: true });
  } catch (error) {
    console.error("No se pudo borrar la carpeta del producto:", error.message);
  }
};

const invoiceUploadDirectory = id => {
  const directory = path.join(invoiceUploadsDir, String(id));
  fs.mkdirSync(directory, { recursive: true });
  return directory;
};

const removeProductImageFiles = imageUrls => {
  let removed = 0;
  for (const imageUrl of imageUrls) {
    const imagePath = localProductImagePath(imageUrl);
    if (!imagePath) continue;
    try {
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
        removed += 1;
      }
    } catch (error) {
      console.error("No se pudo borrar la imagen del producto:", error.message);
    }
  }
  return removed;
};
const AUTH_SECRET = process.env.AUTH_SECRET || "isalme-dev-secret-change-me";
const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173"
]);

const encodeTokenPart = value => Buffer.from(JSON.stringify(value)).toString("base64url");
const signToken = payload => {
  const body = encodeTokenPart({ ...payload, exp: Date.now() + 1000 * 60 * 60 * 24 });
  const signature = crypto.createHmac("sha256", AUTH_SECRET).update(body).digest("base64url");
  return `${body}.${signature}`;
};
const readToken = token => {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature) return null;
  const expected = crypto.createHmac("sha256", AUTH_SECRET).update(body).digest("base64url");
  if (signature !== expected) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  return payload.exp > Date.now() ? payload : null;
};
const requireAuth = (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    const user = readToken(token);
    if (!user) return res.status(401).json({ error: "Sesión inválida o expirada" });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Sesión inválida o expirada" });
  }
};
const optionalAuth = (req, res, next) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return next();
  try {
    const user = readToken(token);
    if (user) req.user = user;
    next();
  } catch {
    next();
  }
};
const requireAdmin = (req, res, next) => {
  if (req.user?.rol !== "admin") return res.status(403).json({ error: "Se requiere una cuenta administradora" });
  next();
};

const ensureProductImagesTable = async () => {
  await pool.query(`ALTER TABLE productos ADD COLUMN IF NOT EXISTS precio_rebaja NUMERIC(10, 2)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS producto_imagenes (
      id SERIAL PRIMARY KEY,
      producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
      url TEXT NOT NULL CHECK (length(trim(url)) > 0),
      orden SMALLINT NOT NULL CHECK (orden BETWEEN 1 AND 5),
      fecha_registro TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (producto_id, orden),
      UNIQUE (producto_id, url)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_producto_imagenes_producto_id
      ON producto_imagenes (producto_id, orden)
  `);
};

const hashPassword = password => {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
};

const verifyPassword = (password, stored) => {
  const [salt, storedHash] = String(stored).split(":");
  if (!salt || !storedHash) return false;
  const hash = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(storedHash, "hex");
  return expected.length === hash.length && crypto.timingSafeEqual(hash, expected);
};

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin) || /^http:\/\/192\.168\.\d+\.\d+:5173$/.test(origin)) return callback(null, true);
    callback(new Error("Origen no permitido por CORS"));
  }
}));

app.use(express.json({ limit: "25mb" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Ruta para comprobar el servidor
app.get("/api", (req, res) => {
  res.json({
    mensaje: "API de Isalme Deco funcionando correctamente"
  });
});

app.post("/api/auth/register", async (req, res) => {
  const nombre = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (!nombre || !/^\S+@\S+\.\S+$/.test(email) || password.length < 6) {
    return res.status(400).json({ error: "Nombre, email válido y contraseña de al menos 6 caracteres son obligatorios" });
  }

  /*
  const detallesNormalizados=[];
  for (const detalle of detalles) {
    const cantidad=Number(detalle?.cantidad);
    const costoUnitario=Number(detalle?.costo_unitario);
    const nuevo=detalle?.nuevo_producto;
    if (!Number.isInteger(cantidad) || cantidad <= 0 || !Number.isFinite(costoUnitario) || costoUnitario < 0) return res.status(400).json({ error: "Revisá los productos, cantidades y costos de la compra" });
    if (nuevo) {
      const nombre=String(nuevo.nombre||"").trim();
      const precio=Number(nuevo.precio);
      if (!nombre || !Number.isFinite(precio) || precio < 0) return res.status(400).json({ error: "Revisá los datos del producto nuevo" });
      detallesNormalizados.push({cantidad,costoUnitario,nuevo:{nombre,precio,descripcion:"",categoriaId:null}});
    } else {
      const idProducto=Number(detalle?.id_producto);
      if (!Number.isInteger(idProducto)) return res.status(400).json({ error: "Seleccioná un producto válido" });
      detallesNormalizados.push({idProducto,cantidad,costoUnitario});
    }
  }
  const cliente=await pool.connect();
  */
   try {
     const resultado = await pool.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol)
       VALUES ($1, $2, $3, 'cliente')
       RETURNING id, nombre, email, rol`,
      [nombre, email, hashPassword(password)]
    );
    const user = resultado.rows[0];
    res.status(201).json({ user, token: signToken({ id: user.id, email: user.email, rol: user.rol }) });
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "Ya existe una cuenta con ese email" });
    console.error("Error al registrar usuario:", error.message);
    res.status(500).json({ error: "No se pudo crear la cuenta" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  try {
    const resultado = await pool.query(
      `SELECT id, nombre, email, rol, password_hash
       FROM usuarios WHERE LOWER(email) = $1 LIMIT 1`,
      [email]
    );
    const usuario = resultado.rows[0];
    if (!usuario || !verifyPassword(password, usuario.password_hash)) {
      return res.status(401).json({ error: "Email o contraseña incorrectos" });
    }
    const { password_hash, ...user } = usuario;
    res.json({ user, token: signToken({ id: user.id, email: user.email, rol: user.rol }) });
  } catch (error) {
    console.error("Error al iniciar sesión:", error.message);
    res.status(500).json({ error: "No se pudo iniciar sesión" });
  }
});

app.post("/api/pedidos", optionalAuth, async (req, res) => {
  const userId = req.user?.id || null;
  const nombre = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const telefono = String(req.body?.phone || "").trim();
  const direccion = String(req.body?.address || "").trim();
  const metodoPago = String(req.body?.payment || "").trim();
  const items = Array.isArray(req.body?.items) ? req.body.items : [];

  if (!nombre || !/^\S+@\S+\.\S+$/.test(email) || !telefono || !direccion || !items.length) {
    return res.status(400).json({ error: "Faltan datos del cliente o del pedido" });
  }

  const cantidades = new Map();
  for (const item of items) {
    const id = Number(item.id);
    const cantidad = Number(item.quantity);
    if (!Number.isInteger(id) || !Number.isInteger(cantidad) || cantidad < 1) {
      return res.status(400).json({ error: "El pedido contiene productos inválidos" });
    }
    cantidades.set(id, (cantidades.get(id) || 0) + cantidad);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ids = [...cantidades.keys()];
    const productos = await client.query(
      "SELECT id, COALESCE(precio_rebaja, precio) AS precio, stock FROM productos WHERE activo = TRUE AND id = ANY($1::int[]) FOR UPDATE",
      [ids]
    );
    if (productos.rows.length !== ids.length) throw Object.assign(new Error("Producto no disponible"), { status: 409 });

    let subtotal = 0;
    for (const producto of productos.rows) {
      const cantidad = cantidades.get(producto.id);
      if (producto.stock < cantidad) throw Object.assign(new Error(`Stock insuficiente para el producto ${producto.id}`), { status: 409 });
      subtotal += Number(producto.precio) * cantidad;
    }
    const envio = subtotal >= 3000 ? 0 : 250;
    const total = subtotal + envio;

    const pedido = await client.query(
      `INSERT INTO pedidos (usuario_id, nombre_cliente, email_cliente, telefono, direccion, tipo_entrega, estado, total)
       VALUES ($1, $2, $3, $4, $5, 'envio', 'pendiente', $6)
       RETURNING id, fecha, total, estado`,
      [userId, nombre, email, telefono, direccion, total]
    );
    const pedidoId = pedido.rows[0].id;

    for (const producto of productos.rows) {
      const cantidad = cantidades.get(producto.id);
      await client.query(
        "INSERT INTO pedido_detalles (pedido_id, producto_id, cantidad, precio_unitario) VALUES ($1, $2, $3, $4)",
        [pedidoId, producto.id, cantidad, producto.precio]
      );
      await client.query("UPDATE productos SET stock = stock - $1 WHERE id = $2", [cantidad, producto.id]);
    }

    await client.query(
      "INSERT INTO pagos (pedido_id, metodo, estado) VALUES ($1, $2, 'pendiente')",
      [pedidoId, metodoPago || "pendiente"]
    );
    await client.query("COMMIT");
    res.status(201).json({ order: pedido.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error al crear pedido:", error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : "No se pudo crear el pedido" });
  } finally {
    client.release();
  }
});

app.get("/api/pedidos", requireAuth, async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT id, fecha, total, estado
       FROM pedidos WHERE usuario_id = $1 ORDER BY fecha DESC, id DESC`,
      [req.user.id]
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error("Error al consultar pedidos:", error.message);
    res.status(500).json({ error: "No se pudieron consultar los pedidos" });
  }
});

app.get("/api/admin/resumen", requireAuth, requireAdmin, async (req, res) => {
  try {
    const [pedidos, clientes, productos] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS total FROM pedidos"),
      pool.query("SELECT COUNT(*)::int AS total FROM usuarios WHERE rol = 'cliente'"),
      pool.query("SELECT COUNT(*)::int AS total FROM productos WHERE activo = TRUE")
    ]);
    res.json({ pedidos: pedidos.rows[0].total, clientes: clientes.rows[0].total, productos: productos.rows[0].total });
  } catch (error) {
    console.error("Error en resumen admin:", error.message);
    res.status(500).json({ error: "No se pudo cargar el resumen" });
  }
});

app.get("/api/admin/clientes", requireAuth, requireAdmin, async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT id, nombre, email, fecha_registro
       FROM usuarios WHERE rol = 'cliente' ORDER BY fecha_registro DESC NULLS LAST, id DESC`
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error("Error al consultar clientes:", error.message);
    res.status(500).json({ error: "No se pudieron cargar los clientes" });
  }
});

app.get("/api/admin/proveedores", requireAuth, requireAdmin, async (req, res) => {
  try {
    const resultado = await pool.query(`
      SELECT id_proveedor, nombre, rut, telefono, email, direccion, observaciones, activo, fecha_creacion
      FROM proveedores
      ORDER BY nombre ASC, id_proveedor ASC
    `);
    res.json(resultado.rows);
  } catch (error) {
    console.error("Error al consultar proveedores:", error.message);
    res.status(500).json({ error: "No se pudieron cargar los proveedores" });
  }
});

app.get("/api/admin/compras", requireAuth, requireAdmin, async (req, res) => {
  try {
    const resultado = await pool.query(`
      SELECT cp.id_compra, cp.id_proveedor, p.nombre AS proveedor_nombre,
             cp.fecha_compra, cp.numero_factura, cp.canal_compra, cp.metodo_entrega,
             cp.costo_envio, cp.fecha_entrega_estimada, cp.fecha_recepcion,
             cp.estado, cp.estado_pago, cp.total, cp.observaciones, cp.fecha_creacion,
             COALESCE((
               SELECT json_agg(json_build_object(
                 'id_producto', d.id_producto,
                 'nombre', prod.nombre,
                 'cantidad', d.cantidad,
                 'costo_unitario', d.costo_unitario,
                 'subtotal', d.subtotal
               ) ORDER BY prod.nombre)
               FROM detalle_compras_proveedores d
               LEFT JOIN productos prod ON prod.id = d.id_producto
               WHERE d.id_compra = cp.id_compra
             ), '[]'::json) AS productos,
             COALESCE((
               SELECT json_agg(json_build_object(
                 'id_archivo', a.id_archivo,
                 'nombre_archivo', a.nombre_archivo,
                 'ruta_archivo', a.ruta_archivo,
                 'tipo_archivo', a.tipo_archivo,
                 'tipo_documento', a.tipo_documento,
                 'fecha_carga', a.fecha_carga
               ) ORDER BY a.fecha_carga DESC, a.id_archivo DESC)
               FROM archivos_compras_proveedores a
               WHERE a.id_compra = cp.id_compra
             ), '[]'::json) AS archivos
      FROM compras_proveedores cp
      LEFT JOIN proveedores p ON p.id_proveedor = cp.id_proveedor
      ORDER BY cp.fecha_compra DESC NULLS LAST, cp.id_compra DESC
    `);
    res.json(resultado.rows);
  } catch (error) {
    console.error("Error al consultar compras a proveedores:", error.message);
    res.status(500).json({ error: "No se pudieron cargar las compras" });
  }
});

app.post("/api/admin/compras", requireAuth, requireAdmin, async (req, res) => {
  const idProveedor = Number(req.body?.id_proveedor);
  const fechaCompra = String(req.body?.fecha_compra || "").trim();
  const numeroFactura = String(req.body?.numero_factura || "").trim() || null;
  const canalSolicitado = String(req.body?.canal_compra || "otro").trim().toLowerCase();
  const canalCompra = ["web", "whatsapp", "local", "otro"].includes(canalSolicitado) ? canalSolicitado : "otro";
  const metodoSolicitado = String(req.body?.metodo_entrega || "retiro").trim().toLowerCase();
  const metodoEntrega = ["envio", "retiro"].includes(metodoSolicitado) ? metodoSolicitado : "retiro";
  const costoEnvio = req.body?.costo_envio === "" || req.body?.costo_envio == null ? 0 : Number(req.body.costo_envio);
  const fechaEntregaEstimada = String(req.body?.fecha_entrega_estimada || "").trim() || null;
  const estadoSolicitado = String(req.body?.estado || "pendiente").trim().toLowerCase();
  const estado = ["pendiente", "recibida", "cancelada"].includes(estadoSolicitado) ? estadoSolicitado : "pendiente";
  const pagoSolicitado = String(req.body?.estado_pago || "pendiente").trim().toLowerCase();
  const estadoPago = ["pendiente", "parcial", "pagado"].includes(pagoSolicitado) ? pagoSolicitado : "pendiente";
  const total = req.body?.total === "" || req.body?.total == null ? 0 : Number(req.body.total);
  const observaciones = String(req.body?.observaciones || "").trim() || null;
  const client = await pool.connect();
  let detalles = [];
  const detallesNormalizados=[];
  for (const detalle of detalles) {
    const cantidad=Number(detalle?.cantidad);
    const costoUnitario=Number(detalle?.costo_unitario);
    const nuevo=detalle?.nuevo_producto;
    if (!Number.isInteger(cantidad) || cantidad <= 0 || !Number.isFinite(costoUnitario) || costoUnitario < 0) return res.status(400).json({ error: "Revisá los productos, cantidades y costos de la compra" });
    if (nuevo) {
      const nombreNuevo=String(nuevo.nombre||"").trim();
      const precioNuevo=Number(nuevo.precio);
      if (!nombreNuevo || !Number.isFinite(precioNuevo) || precioNuevo < 0) return res.status(400).json({ error: "Revisá los datos del producto nuevo" });
      detallesNormalizados.push({cantidad,costoUnitario,nuevo:{nombre:nombreNuevo,precio:precioNuevo,descripcion:"",categoriaId:null}});
    } else {
      const idProducto=Number(detalle?.id_producto);
      if (!Number.isInteger(idProducto)) return res.status(400).json({ error: "Seleccioná un producto válido" });
      detallesNormalizados.push({idProducto,cantidad,costoUnitario});
    }
  }
  try { detalles = typeof req.body?.detalles === "string" ? JSON.parse(req.body.detalles || "[]") : (Array.isArray(req.body?.detalles) ? req.body.detalles : []); } catch { return res.status(400).json({ error: "Los productos de la compra no son válidos" }); }
  if (!Number.isInteger(idProveedor)) return res.status(400).json({ error: "Seleccioná un proveedor" });
  for (const detalle of detalles) {
    const cantidad=Number(detalle?.cantidad);
    const costoUnitario=Number(detalle?.costo_unitario);
    const nuevo=detalle?.nuevo_producto;
    if (!Number.isInteger(cantidad) || cantidad <= 0 || !Number.isFinite(costoUnitario) || costoUnitario < 0) return res.status(400).json({ error: "Revisá los productos, cantidades y costos de la compra" });
    if (nuevo) {
      const nombreNuevo=String(nuevo.nombre||"").trim();
      const precioNuevo=Number(nuevo.precio);
      if (!nombreNuevo || !Number.isFinite(precioNuevo) || precioNuevo < 0) return res.status(400).json({ error: "Revisá los datos del producto nuevo" });
      detallesNormalizados.push({cantidad,costoUnitario,nuevo:{nombre:nombreNuevo,precio:precioNuevo,descripcion:"",categoriaId:null}});
    } else {
      const idProducto=Number(detalle?.id_producto);
      if (!Number.isInteger(idProducto)) return res.status(400).json({ error: "Seleccioná un producto válido" });
      detallesNormalizados.push({idProducto,cantidad,costoUnitario});
    }
  }
  if (!fechaCompra) return res.status(400).json({ error: "La fecha de compra es obligatoria" });
  if (!Number.isFinite(total) || total < 0 || (costoEnvio !== null && (!Number.isFinite(costoEnvio) || costoEnvio < 0))) return res.status(400).json({ error: "Los importes deben ser números válidos" });
  try {
    await client.query("BEGIN");
    const resultado = await client.query(
      `INSERT INTO compras_proveedores
       (id_proveedor, fecha_compra, numero_factura, canal_compra, metodo_entrega, costo_envio, fecha_entrega_estimada, estado, estado_pago, total, observaciones)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [idProveedor, fechaCompra, numeroFactura, canalCompra, metodoEntrega, costoEnvio, fechaEntregaEstimada, estado, estadoPago, total, observaciones]
    );
    for (const detalle of detallesNormalizados) {
      let idProducto = detalle.idProducto;
      if (detalle.nuevo) {
        const productoNuevo=await client.query(
          `INSERT INTO productos (nombre, descripcion, precio, precio_rebaja, stock, categoria_id, imagen, activo)
           VALUES ($1, $2, 0, NULL, 0, $3, NULL, FALSE)
           RETURNING id`,
          [detalle.nuevo.nombre,detalle.nuevo.descripcion,detalle.nuevo.categoriaId]
        );
        idProducto=productoNuevo.rows[0].id;
      }
      const cantidad=detalle.cantidad;
      const costoUnitario=detalle.costoUnitario;
      if (!Number.isInteger(idProducto) || !Number.isInteger(cantidad) || cantidad <= 0 || !Number.isFinite(costoUnitario) || costoUnitario < 0) return res.status(400).json({ error: "Revisá los productos, cantidades y costos de la compra" });
      await client.query(
        `INSERT INTO detalle_compras_proveedores (id_compra, id_producto, cantidad, costo_unitario)
         VALUES ($1, $2, $3, $4)`,
        [resultado.rows[0].id_compra, idProducto, cantidad, costoUnitario]
      );
      const stockActualizado=await client.query("UPDATE productos SET stock = stock + $1 WHERE id = $2",[cantidad,idProducto]);
      if (!stockActualizado.rowCount) throw Object.assign(new Error("Producto inexistente"),{code:"PRODUCT_NOT_FOUND"});
    }
    await client.query("COMMIT");
    res.status(201).json(resultado.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "PRODUCT_NOT_FOUND") return res.status(400).json({ error: "Uno de los productos seleccionados no existe" });
    if (error.code === "23503") return res.status(400).json({ error: "El proveedor o producto seleccionado no existe" });
    console.error("Error al crear compra a proveedor:", error.message);
    res.status(500).json({ error: "No se pudo registrar la compra" });
  } finally {
    client.release();
  }
});

app.post("/api/admin/compras/:id/archivos", requireAuth, requireAdmin, async (req, res) => {
  const idCompra = Number(req.params.id);
  const archivo = req.body?.archivo;
  if (!Number.isInteger(idCompra) || !archivo?.data) return res.status(400).json({ error: "Seleccioná un archivo" });
  const compra = await pool.query("SELECT id_compra FROM compras_proveedores WHERE id_compra = $1", [idCompra]);
  if (!compra.rowCount) return res.status(404).json({ error: "Compra no encontrada" });
  const match = String(archivo.data).match(/^data:(application\/pdf|image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
  if (!match) return res.status(400).json({ error: "La factura debe ser PDF o imagen" });
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > 15 * 1024 * 1024) return res.status(400).json({ error: "El archivo supera el máximo de 15 MB" });
  const extensiones = { "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };
  const tipoArchivo = match[1];
  const nombreOriginal = path.basename(String(archivo.nombre || "factura"));
  const nombreArchivo = `compra-${idCompra}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${extensiones[tipoArchivo]}`;
  const invoiceUploadDir = invoiceUploadDirectory(idCompra);
  const rutaFisica = path.join(invoiceUploadDir, nombreArchivo);
  const rutaPublica = `/uploads/facturas/${idCompra}/${nombreArchivo}`;
  try {
    fs.writeFileSync(rutaFisica, buffer);
    const resultado = await pool.query(
      `INSERT INTO archivos_compras_proveedores (id_compra, nombre_archivo, ruta_archivo, tipo_archivo, tipo_documento)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id_archivo, id_compra, nombre_archivo, ruta_archivo, tipo_archivo, tipo_documento, fecha_carga`,
      [idCompra, nombreOriginal, rutaPublica, tipoArchivo, "factura"]
    );
    res.status(201).json(resultado.rows[0]);
  } catch (error) {
    try { fs.unlinkSync(rutaFisica); } catch {}
    console.error("Error al guardar archivo de compra:", error.message);
    res.status(error.code === "23514" ? 400 : 500).json({ error: error.code === "23514" ? "El tipo de documento no es válido" : "No se pudo guardar la factura" });
  }
});

app.delete("/api/admin/compras/:id/archivos/:archivoId", requireAuth, requireAdmin, async (req, res) => {
  const idCompra = Number(req.params.id);
  const idArchivo = Number(req.params.archivoId);
  if (!Number.isInteger(idCompra) || !Number.isInteger(idArchivo)) return res.status(400).json({ error: "Archivo inválido" });
  try {
    const resultado = await pool.query("DELETE FROM archivos_compras_proveedores WHERE id_archivo = $1 AND id_compra = $2 RETURNING ruta_archivo", [idArchivo, idCompra]);
    if (!resultado.rowCount) return res.status(404).json({ error: "Archivo no encontrado" });
    const ruta = String(resultado.rows[0].ruta_archivo || "");
    if (ruta.startsWith("/uploads/facturas/")) {
      const rutaRelativa = ruta.slice("/uploads/facturas/".length);
      const rutaFisica = path.resolve(invoiceUploadsDir, decodeURIComponent(rutaRelativa));
      const facturasRoot = path.resolve(invoiceUploadsDir);
      if (rutaFisica.startsWith(`${facturasRoot}${path.sep}`)) {
        try { fs.unlinkSync(rutaFisica); } catch {}
      }
    }
    res.json({ id_archivo: idArchivo });
  } catch (error) {
    console.error("Error al borrar archivo de compra:", error.message);
    res.status(500).json({ error: "No se pudo borrar la factura" });
  }
});

app.patch("/api/admin/compras/:id", requireAuth, requireAdmin, async (req, res) => {
  const idCompra=Number(req.params.id);
  const idProveedor=Number(req.body?.id_proveedor);
  const fechaCompra=String(req.body?.fecha_compra||'').trim();
  const numeroFactura=String(req.body?.numero_factura||'').trim()||null;
  const canalCompra=['web','whatsapp','local','otro'].includes(String(req.body?.canal_compra||'').toLowerCase())?String(req.body.canal_compra).toLowerCase():'otro';
  const metodoEntrega=['envio','retiro'].includes(String(req.body?.metodo_entrega||'').toLowerCase())?String(req.body.metodo_entrega).toLowerCase():'retiro';
  const costoEnvio=Number(req.body?.costo_envio||0);
  const fechaEntrega=String(req.body?.fecha_entrega_estimada||'').trim()||null;
  const estado=['pendiente','recibida','cancelada'].includes(String(req.body?.estado||'').toLowerCase())?String(req.body.estado).toLowerCase():'pendiente';
  const estadoPago=['pendiente','parcial','pagado'].includes(String(req.body?.estado_pago||'').toLowerCase())?String(req.body.estado_pago).toLowerCase():'pendiente';
  const total=Number(req.body?.total||0);
  const observaciones=String(req.body?.observaciones||'').trim()||null;
  if(!Number.isInteger(idCompra)||!Number.isInteger(idProveedor)||!fechaCompra||!Number.isFinite(costoEnvio)||costoEnvio<0||!Number.isFinite(total)||total<0)return res.status(400).json({error:'Revisá los datos de la compra'});
  try{const resultado=await pool.query(`UPDATE compras_proveedores SET id_proveedor=$1,fecha_compra=$2,numero_factura=$3,canal_compra=$4,metodo_entrega=$5,costo_envio=$6,fecha_entrega_estimada=$7,estado=$8,estado_pago=$9,total=$10,observaciones=$11 WHERE id_compra=$12 RETURNING *`,[idProveedor,fechaCompra,numeroFactura,canalCompra,metodoEntrega,costoEnvio,fechaEntrega,estado,estadoPago,total,observaciones,idCompra]);if(!resultado.rowCount)return res.status(404).json({error:'Compra no encontrada'});res.json(resultado.rows[0])}catch(error){console.error('Error al actualizar compra:',error.message);res.status(error.code==='23503'?400:500).json({error:error.code==='23503'?'El proveedor seleccionado no existe':'No se pudo actualizar la compra'})}
});

app.delete("/api/admin/compras/:id", requireAuth, requireAdmin, async (req, res) => {
  const idCompra=Number(req.params.id);if(!Number.isInteger(idCompra))return res.status(400).json({error:'Compra inválida'});
  const client=await pool.connect();
  try{await client.query('BEGIN');const existe=await client.query('SELECT id_compra FROM compras_proveedores WHERE id_compra=$1 FOR UPDATE',[idCompra]);if(!existe.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Compra no encontrada'})}const detalles=await client.query('SELECT id_producto,cantidad FROM detalle_compras_proveedores WHERE id_compra=$1 FOR UPDATE',[idCompra]);for(const detalle of detalles.rows){const actualizado=await client.query('UPDATE productos SET stock=stock-$1 WHERE id=$2 AND stock >= $1',[detalle.cantidad,detalle.id_producto]);if(!actualizado.rowCount)throw Object.assign(new Error('Stock insuficiente'),{code:'STOCK_ERROR'})}await client.query('DELETE FROM detalle_compras_proveedores WHERE id_compra=$1',[idCompra]);await client.query('DELETE FROM compras_proveedores WHERE id_compra=$1',[idCompra]);await client.query('COMMIT');res.json({id_compra:idCompra})}catch(error){await client.query('ROLLBACK');console.error('Error al borrar compra:',error.message);res.status(error.code==='STOCK_ERROR'?400:500).json({error:error.code==='STOCK_ERROR'?'El stock no permite eliminar esta compra':'No se pudo borrar la compra'})}finally{client.release()}
});

app.post("/api/admin/proveedores", requireAuth, requireAdmin, async (req, res) => {
  const nombre = String(req.body?.nombre || "").trim();
  const rut = String(req.body?.rut || "").trim();
  const telefono = String(req.body?.telefono || "").trim();
  const email = String(req.body?.email || "").trim() || null;
  const direccion = String(req.body?.direccion || "").trim() || null;
  const observaciones = String(req.body?.observaciones || "").trim() || null;
  if (!nombre || !rut) return res.status(400).json({ error: "Nombre y RUT son obligatorios" });
  try {
    const resultado = await pool.query(
      `INSERT INTO proveedores (nombre, rut, telefono, email, direccion, observaciones, activo)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)
       RETURNING id_proveedor, nombre, rut, telefono, email, direccion, observaciones, activo, fecha_creacion`,
      [nombre, rut, telefono || null, email, direccion, observaciones]
    );
    res.status(201).json(resultado.rows[0]);
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "Ya existe un proveedor con ese RUT" });
    console.error("Error al crear proveedor:", error.message);
    res.status(500).json({ error: "No se pudo crear el proveedor" });
  }
});

app.patch("/api/admin/proveedores/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const nombre = String(req.body?.nombre || "").trim();
  const rut = String(req.body?.rut || "").trim();
  const telefono = String(req.body?.telefono || "").trim();
  const email = String(req.body?.email || "").trim() || null;
  const direccion = String(req.body?.direccion || "").trim() || null;
  const observaciones = String(req.body?.observaciones || "").trim() || null;
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Proveedor inválido" });
  if (!nombre || !rut) return res.status(400).json({ error: "Nombre y RUT son obligatorios" });
  try {
    const resultado = await pool.query(
      `UPDATE proveedores
       SET nombre = $1, rut = $2, telefono = $3, email = $4, direccion = $5, observaciones = $6
       WHERE id_proveedor = $7
       RETURNING id_proveedor, nombre, rut, telefono, email, direccion, observaciones, activo, fecha_creacion`,
      [nombre, rut, telefono || null, email, direccion, observaciones, id]
    );
    if (!resultado.rowCount) return res.status(404).json({ error: "Proveedor no encontrado" });
    res.json(resultado.rows[0]);
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "Ya existe un proveedor con ese RUT" });
    console.error("Error al actualizar proveedor:", error.message);
    res.status(500).json({ error: "No se pudo actualizar el proveedor" });
  }
});

app.patch("/api/admin/proveedores/:id/estado", requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Proveedor inválido" });
  try {
    const resultado = await pool.query(
      "UPDATE proveedores SET activo = $1 WHERE id_proveedor = $2 RETURNING id_proveedor, activo",
      [Boolean(req.body?.activo), id]
    );
    if (!resultado.rowCount) return res.status(404).json({ error: "Proveedor no encontrado" });
    res.json(resultado.rows[0]);
  } catch (error) {
    console.error("Error al cambiar estado del proveedor:", error.message);
    res.status(500).json({ error: "No se pudo cambiar el estado del proveedor" });
  }
});

app.get("/api/admin/productos", requireAuth, requireAdmin, async (req, res) => {
  try {
    const resultado = await pool.query(`
      SELECT p.id, p.nombre, p.descripcion, p.precio, p.precio_rebaja, p.stock, p.imagen,
             p.activo, p.categoria_id, c.nombre AS categoria,
             COALESCE((
               SELECT json_agg(json_build_object('id', pi.id, 'url', pi.url, 'orden', pi.orden) ORDER BY pi.orden)
               FROM producto_imagenes pi WHERE pi.producto_id = p.id
             ), '[]'::json) AS imagenes
      FROM productos p
      LEFT JOIN categorias c ON p.categoria_id = c.id
      ORDER BY p.id
    `);
    res.json(resultado.rows);
  } catch (error) {
    console.error("Error al consultar productos admin:", error.message);
    res.status(500).json({ error: "No se pudieron cargar los productos" });
  }
});

app.post("/api/admin/productos", requireAuth, requireAdmin, async (req, res) => {
  const nombre = String(req.body?.nombre || "").trim();
  const descripcion = String(req.body?.descripcion || "").trim();
  const precio = Number(req.body?.precio);
  const stock = Number(req.body?.stock);
  const precioRebaja = req.body?.precio_rebaja === null || req.body?.precio_rebaja === undefined || req.body?.precio_rebaja === ""
    ? null
    : Number(req.body.precio_rebaja);
  const imagen = String(req.body?.imagen || "").trim() || null;
  const categoriaId = req.body?.categoria_id ? Number(req.body.categoria_id) : null;
  if (!nombre || !Number.isFinite(precio) || precio < 0 || !Number.isInteger(stock) || stock < 0 || (precioRebaja !== null && (!Number.isFinite(precioRebaja) || precioRebaja < 0 || precioRebaja >= precio))) {
    return res.status(400).json({ error: "Nombre, precio, stock o rebaja inválidos" });
  }
  try {
    const resultado = await pool.query(
      `INSERT INTO productos (nombre, descripcion, precio, precio_rebaja, stock, categoria_id, imagen, activo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)
       RETURNING id, nombre, descripcion, precio, precio_rebaja, stock, categoria_id, imagen, activo`,
      [nombre, descripcion, precio, precioRebaja, stock, categoriaId, imagen]
    );
    productUploadDirectory(resultado.rows[0].id);
    res.status(201).json(resultado.rows[0]);
  } catch (error) {
    console.error("Error al crear producto:", error.message);
    res.status(500).json({ error: "No se pudo crear el producto" });
  }
});

app.put("/api/admin/productos/:id/imagenes", requireAuth, requireAdmin, async (req, res) => {
  const productoId = Number(req.params.id);
  const imagenes = Array.isArray(req.body?.imagenes)
    ? [...new Set(req.body.imagenes.map(imagen => String(imagen || "").trim()).filter(Boolean))]
    : null;
  if (!Number.isInteger(productoId) || !imagenes || imagenes.length > 5) {
    return res.status(400).json({ error: "Un producto puede tener entre 0 y 5 imágenes" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const producto = await client.query("SELECT id FROM productos WHERE id = $1", [productoId]);
    if (!producto.rowCount) throw Object.assign(new Error("Producto no encontrado"), { status: 404 });
    await client.query("DELETE FROM producto_imagenes WHERE producto_id = $1", [productoId]);
    for (const [indice, url] of imagenes.entries()) {
      await client.query(
        "INSERT INTO producto_imagenes (producto_id, url, orden) VALUES ($1, $2, $3)",
        [productoId, url, indice + 1]
      );
    }
    await client.query("COMMIT");
    res.json({ producto_id: productoId, imagenes: imagenes.map((url, indice) => ({ url, orden: indice + 1 })) });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error al actualizar imágenes del producto:", error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : "No se pudieron actualizar las imágenes" });
  } finally {
    client.release();
  }
});

app.post("/api/admin/productos/:id/imagenes/upload", requireAuth, requireAdmin, async (req, res) => {
  const productoId = Number(req.params.id);
  const archivos = Array.isArray(req.body?.imagenes) ? req.body.imagenes : null;
  const reemplazar = req.body?.reemplazar !== false;
  const extensiones = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
  if (!Number.isInteger(productoId) || !archivos || archivos.length > 5) {
    return res.status(400).json({ error: "Seleccioná entre 0 y 5 imágenes" });
  }

  const archivosProcesados = [];
  try {
    const productoArchivo = await pool.query("SELECT nombre FROM productos WHERE id = $1", [productoId]);
    if (!productoArchivo.rowCount) throw Object.assign(new Error("Producto no encontrado"), { status: 404 });
    const carpetaProducto = productFolderName(productoId);
    const productUploadDir = productUploadDirectory(productoId);

    for (const [indice, archivo] of archivos.entries()) {
      const match = String(archivo?.data || "").match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
      if (!match) throw Object.assign(new Error("Solo se permiten imágenes JPG, PNG, WEBP o GIF"), { status: 400 });
      const buffer = Buffer.from(match[2], "base64");
      if (buffer.length > 5 * 1024 * 1024) throw Object.assign(new Error("Cada imagen puede pesar hasta 5 MB"), { status: 400 });
      const nombre = `producto-${productoId}-${Date.now()}-${indice}.${extensiones[match[1]]}`;
      fs.writeFileSync(path.join(productUploadDir, nombre), buffer);
      archivosProcesados.push(`http://${req.get("host")}/uploads/productos/${carpetaProducto}/${nombre}`);
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const producto = await client.query("SELECT id FROM productos WHERE id = $1", [productoId]);
      if (!producto.rowCount) throw Object.assign(new Error("Producto no encontrado"), { status: 404 });
      const existentes = await client.query(
        "SELECT url FROM producto_imagenes WHERE producto_id = $1 ORDER BY orden, id",
        [productoId]
      );
      if (!reemplazar && existentes.rowCount + archivosProcesados.length > 5) {
        throw Object.assign(new Error("Un producto puede tener como máximo 5 imágenes"), { status: 400 });
      }
      if (reemplazar) {
        await client.query("DELETE FROM producto_imagenes WHERE producto_id = $1", [productoId]);
      }
      const ordenInicial = reemplazar ? 0 : existentes.rowCount;
      for (const [indice, url] of archivosProcesados.entries()) {
        await client.query(
          "INSERT INTO producto_imagenes (producto_id, url, orden) VALUES ($1, $2, $3)",
          [productoId, url, ordenInicial + indice + 1]
        );
      }
      await client.query("COMMIT");
      const imagenes = reemplazar
        ? archivosProcesados.map((url, indice) => ({ url, orden: indice + 1 }))
        : existentes.rows.map((imagen, indice) => ({ url: imagen.url, orden: indice + 1 })).concat(
            archivosProcesados.map((url, indice) => ({ url, orden: existentes.rowCount + indice + 1 }))
          );
      res.json({ producto_id: productoId, imagenes });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error al subir imágenes del producto:", error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : "No se pudieron guardar las imágenes" });
  }
});

app.patch("/api/admin/productos/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const nombre = String(req.body?.nombre || "").trim();
  const descripcion = String(req.body?.descripcion || "").trim();
  const precio = Number(req.body?.precio);
  const stock = Number(req.body?.stock);
  const precioRebaja = req.body?.precio_rebaja === null || req.body?.precio_rebaja === undefined || req.body?.precio_rebaja === ""
    ? null
    : Number(req.body.precio_rebaja);
  const categoriaId = req.body?.categoria_id ? Number(req.body.categoria_id) : null;
  if (!Number.isInteger(id) || !nombre || !Number.isFinite(precio) || precio < 0 || !Number.isInteger(stock) || stock < 0 || (precioRebaja !== null && (!Number.isFinite(precioRebaja) || precioRebaja < 0 || precioRebaja >= precio)) || (categoriaId !== null && !Number.isInteger(categoriaId))) {
    return res.status(400).json({ error: "Nombre, precio, stock, rebaja o categoría inválidos" });
  }
  try {
    const resultado = await pool.query(
      "UPDATE productos SET nombre = $1, descripcion = $2, precio = $3, precio_rebaja = $4, stock = $5, categoria_id = $6 WHERE id = $7 RETURNING id, nombre, descripcion, precio, precio_rebaja, stock, categoria_id, activo",
      [nombre, descripcion, precio, precioRebaja, stock, categoriaId, id]
    );
    if (!resultado.rowCount) return res.status(404).json({ error: "Producto no encontrado" });
    res.json(resultado.rows[0]);
  } catch (error) {
    console.error("Error al actualizar producto:", error.message);
    res.status(500).json({ error: "No se pudo actualizar el producto" });
  }
});

app.patch("/api/admin/productos/:id/estado", requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const activo = req.body?.activo;
  if (!Number.isInteger(id) || typeof activo !== "boolean") {
    return res.status(400).json({ error: "Estado de producto inválido" });
  }
  try {
    const resultado = await pool.query(
      "UPDATE productos SET activo = $1 WHERE id = $2 RETURNING id, nombre, activo",
      [activo, id]
    );
    if (!resultado.rowCount) return res.status(404).json({ error: "Producto no encontrado" });
    res.json(resultado.rows[0]);
  } catch (error) {
    console.error("Error al cambiar estado del producto:", error.message);
    res.status(500).json({ error: "No se pudo cambiar el estado del producto" });
  }
});

app.delete("/api/admin/productos/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Producto inválido" });
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const imagenesProducto = await client.query(
      `SELECT p.nombre, p.imagen, COALESCE(array_agg(pi.url) FILTER (WHERE pi.url IS NOT NULL), '{}') AS imagenes
       FROM productos p
       LEFT JOIN producto_imagenes pi ON pi.producto_id = p.id
       WHERE p.id = $1
       GROUP BY p.id, p.nombre, p.imagen`,
      [id]
    );
    if (!imagenesProducto.rowCount) {
      await client.query("ROLLBACK");
      client.release();
      return res.status(404).json({ error: "Producto no encontrado" });
    }
    const imagenes = [imagenesProducto.rows[0].imagen, ...imagenesProducto.rows[0].imagenes].filter(Boolean);
    await client.query("DELETE FROM productos WHERE id = $1", [id]);
    const imagenesRestantes = await client.query(
      "SELECT url FROM producto_imagenes WHERE url = ANY($1::text[])",
      [imagenes]
    );
    const urlsRestantes = new Set(imagenesRestantes.rows.map(row => row.url));
    await client.query("COMMIT");
    client.release();

    const imagenesEliminadas = removeProductImageFiles(imagenes.filter(url => !urlsRestantes.has(url)));
    removeProductUploadDirectory(id);
    res.json({ id, eliminado: true, imagenes_eliminadas: imagenesEliminadas });
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
    console.error("Error al borrar producto:", error.message);
    if (error.code === "23503") {
      return res.status(409).json({ error: "No se puede borrar este producto porque tiene pedidos asociados. Desactivalo en su lugar." });
    }
    if (error.status === 404) return res.status(404).json({ error: error.message });
    res.status(409).json({ error: "No se puede borrar este producto porque tiene pedidos asociados. Desactivalo en su lugar." });
  }
});

// Ruta para obtener productos de PostgreSQL
app.get("/api/productos", async (req, res) => {
  try {
    const resultado = await pool.query(`
  SELECT
    p.id,
    p.nombre,
    p.descripcion,
    p.precio,
    p.precio_rebaja,
    p.stock,
    p.imagen,
    p.activo,
    p.categoria_id,
    c.nombre AS categoria,
    COALESCE((
      SELECT json_agg(
        json_build_object('id', pi.id, 'url', pi.url, 'orden', pi.orden)
        ORDER BY pi.orden
      )
      FROM producto_imagenes pi
      WHERE pi.producto_id = p.id
    ), '[]'::json) AS imagenes
  FROM productos p
  LEFT JOIN categorias c
    ON p.categoria_id = c.id
  WHERE p.activo = TRUE
  ORDER BY p.id
`);
    res.json(resultado.rows);

  } catch (error) {
    console.error("Error PostgreSQL:", error.message);

    res.status(500).json({
      error: "Error al consultar productos"
    });
  }
});

const PORT = process.env.PORT || 3000;

ensureProductImagesTable()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor funcionando en puerto ${PORT}`);
    });
  })
  .catch(error => {
    console.error("No se pudo preparar la tabla de imágenes de productos:", error.message);
    process.exitCode = 1;
  });

const pool = require("./db");

const departamentos = [
  [1, "MONTEVIDEO"], [2, "ARTIGAS"], [3, "CANELONES"], [4, "CERRO LARGO"],
  [5, "COLONIA"], [6, "DURAZNO"], [7, "FLORES"], [8, "FLORIDA"],
  [9, "LAVALLEJA"], [10, "MALDONADO"], [11, "PAYSANDU"], [12, "RIO NEGRO"],
  [13, "RIVERA"], [14, "ROCHA"], [15, "SALTO"], [16, "SAN JOSE"],
  [17, "SORIANO"], [18, "TACUAREMBO"], [19, "TREINTA Y TRES"]
];

const cargarLocalidades = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS localidades (
      id SERIAL PRIMARY KEY,
      departamento_id INTEGER NOT NULL REFERENCES departamentos(id) ON DELETE RESTRICT,
      nombre TEXT NOT NULL,
      codigo_postal TEXT,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      UNIQUE (departamento_id, nombre)
    )
  `);

  let total = 0;
  for (const [departamentoId, nombreDepartamento] of departamentos) {
    const respuesta = await fetch(
      `https://direcciones.ide.uy/api/v0/geocode/localidades?departamento=${encodeURIComponent(nombreDepartamento)}&alias=true`
    );
    if (!respuesta.ok) throw new Error(`${nombreDepartamento}: HTTP ${respuesta.status}`);

    const localidades = await respuesta.json();
    for (const localidad of localidades) {
      await pool.query(
        `INSERT INTO localidades (departamento_id, nombre, codigo_postal)
         VALUES ($1, $2, $3)
         ON CONFLICT (departamento_id, nombre)
         DO UPDATE SET codigo_postal = EXCLUDED.codigo_postal, activo = TRUE`,
        [departamentoId, localidad.nombre, localidad.codigoPostal ? String(localidad.codigoPostal) : null]
      );
    }
    total += localidades.length;
    console.log(`${nombreDepartamento}: ${localidades.length} localidades`);
  }

  const resultado = await pool.query("SELECT COUNT(*)::int AS total FROM localidades");
  console.log(`Carga finalizada: ${resultado.rows[0].total} localidades guardadas en la tabla localidades (API: ${total})`);
};

cargarLocalidades()
  .catch(error => {
    console.error("No se pudieron cargar las localidades:", error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

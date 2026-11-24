const readline = require("readline");
const crypto = require("crypto");
const pool = require("./db");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const ask = question => new Promise(resolve => rl.question(question, resolve));

const hashPassword = password => {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
};

async function main() {
  const nombre = (await ask("Nombre del administrador: ")).trim();
  const email = (await ask("Email del administrador: ")).trim().toLowerCase();
  const password = await ask("Contraseña (mínimo 6 caracteres): ");

  if (!nombre || !/^\S+@\S+\.\S+$/.test(email) || password.length < 5) {
    throw new Error("Los datos no son válidos");
  }

  await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol)
     VALUES ($1, $2, $3, 'admin')`,
    [nombre, email, hashPassword(password)]
  );

  console.log(`Administrador creado: ${email}`);
}

main()
  .catch(error => {
    if (error.code === "23505") console.error("Ya existe un usuario con ese email");
    else console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await pool.end();
  });

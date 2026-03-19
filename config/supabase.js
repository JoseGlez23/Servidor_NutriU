require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

const isPlaceholder = (value = "") => {
  const normalized = String(value).toLowerCase();
  return normalized.includes("replace_with") || normalized.includes("your_");
};

if (
  !supabaseUrl ||
  !supabaseKey ||
  isPlaceholder(supabaseUrl) ||
  isPlaceholder(supabaseKey)
) {
  console.error("❌ Variables de Supabase invalidas para ejecucion local.");
  console.error(
    "SUPABASE_URL:",
    supabaseUrl && !isPlaceholder(supabaseUrl)
      ? "✅ Configurada"
      : "❌ Faltante o placeholder",
  );
  console.error(
    "SUPABASE_SERVICE_KEY:",
    supabaseKey && !isPlaceholder(supabaseKey)
      ? "✅ Configurada"
      : "❌ Faltante o placeholder",
  );
  throw new Error(
    "Configura SUPABASE_URL y SUPABASE_SERVICE_KEY reales en Servidor_NutriU/.env",
  );
}

const supabase = createClient(supabaseUrl, supabaseKey);

supabase
  .from("usuarios")
  .select("count", { count: "exact", head: true })
  .then(({ error }) => {
    if (error) {
      const details = {
        message: error.message || null,
        code: error.code || null,
        details: error.details || null,
        hint: error.hint || null,
      };
      console.error("❌ Error conectando a Supabase:", JSON.stringify(details));
    } else {
      console.log("✅ Conectado a Supabase correctamente");
    }
  })
  .catch((err) => {
    console.error("❌ Error en conexion Supabase:", err.message || err);
  });

module.exports = supabase;

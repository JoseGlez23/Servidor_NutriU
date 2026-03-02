
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL 
const supabaseKey = process.env.SUPABASE_SERVICE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Faltan las variables de entorno de Supabase');
  console.error('SUPABASE_URL:', supabaseUrl ? '✅ Configurada' : '❌ Faltante');
  console.error('SUPABASE_SERVICE_KEY:', supabaseKey ? '✅ Configurada' : '❌ Faltante');
}

const supabase = createClient(supabaseUrl, supabaseKey);

supabase.from('usuarios').select('count', { count: 'exact', head: true })
  .then(({ error }) => {
    if (error) {
      console.error('❌ Error conectando a Supabase:', error.message);
    } else {
      console.log('✅ Conectado a Supabase correctamente');
    }
  })
  .catch(err => {
    console.error('❌ Error en conexión Supabase:', err.message);
  });

module.exports = supabase;
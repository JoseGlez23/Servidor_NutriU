const express = require("express");
const router = express.Router();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const supabase = require("../config/supabase");

// Crear Payment Intent (sin consultar cita, usa monto enviado desde la app)
router.post("/create-payment-intent", async (req, res) => {
  try {
    const { appointmentId, userId, appointmentTitle, monto } = req.body;

    console.log("[CREATE INTENT] Recibido:", { appointmentId, userId, monto, title: appointmentTitle });

    if (!appointmentId || !userId || !monto) {
      return res.status(400).json({ error: "appointmentId, userId y monto son requeridos" });
    }

    // Validación opcional: verifica que la cita exista (para seguridad)
    const { data: cita, error: citaError } = await supabase
      .from("citas")
      .select("id_cita")
      .eq("id_cita", appointmentId)
      .single();

    if (citaError || !cita) {
      console.error("[CREATE INTENT] Cita no encontrada:", citaError?.message);
      return res.status(400).json({ error: "Cita no encontrada o inválida" });
    }

    const amountInCents = Math.round(monto * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: "mxn",
      metadata: { appointmentId, userId, appointmentTitle, monto: monto.toString() },
      payment_method_types: ["card"],
      description: `Pago cita NutriU: ${appointmentTitle || "Consulta"}`,
    });

    console.log("[CREATE INTENT] Intent creado:", paymentIntent.id);

    res.json({
      clientSecret: paymentIntent.client_secret,
      amount: monto,
    });
  } catch (err) {
    console.error("[CREATE INTENT] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Ruta opcional de confirmación manual (puedes eliminarla si usas solo webhook)
router.post("/confirm-payment", async (req, res) => {
  try {
    const { paymentIntentId } = req.body;
    if (!paymentIntentId) return res.status(400).json({ error: "paymentIntentId requerido" });

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (paymentIntent.status !== "succeeded") {
      return res.status(400).json({ error: "Pago no exitoso" });
    }

    const { userId, appointmentId, monto } = paymentIntent.metadata;

    // Registrar pago (webhook debería hacer esto, pero como fallback)
    const { error: pagoError } = await supabase.from("pagos").insert({
      id_cita: appointmentId,
      id_paciente: userId,
      monto: parseFloat(monto),
      metodo_pago: "stripe",
      estado: "completado",
      stripe_payment_id: paymentIntentId,
      fecha_pago: new Date().toISOString(),
    });

    if (pagoError) throw pagoError;

    res.json({ success: true, message: "Pago confirmado" });
  } catch (err) {
    console.error("Error confirmando:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
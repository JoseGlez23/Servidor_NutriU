const express = require("express");
const router = express.Router();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const supabase = require("../config/supabase");  // ← Ajusta la ruta: desde api/routes/ sube dos niveles

// Crear Payment Intent
router.post("/create-payment-intent", async (req, res) => {
  try {
    const { appointmentId, userId, appointmentTitle, monto } = req.body;

    console.log("[CREATE INTENT] Recibido:", { appointmentId, userId, monto, title: appointmentTitle });

    if (!appointmentId || !userId || !monto || monto <= 0) {
      return res.status(400).json({ error: "appointmentId, userId y monto válido son requeridos" });
    }

    // Validación de cita (seguridad extra)
    const { data: cita, error: citaError } = await supabase
      .from("citas")
      .select("id_cita, estado")
      .eq("id_cita", appointmentId)
      .single();

    if (citaError || !cita) {
      console.error("[CREATE INTENT] Cita no encontrada:", citaError?.message);
      return res.status(404).json({ error: "Cita no encontrada o inválida" });
    }

    if (cita.estado !== "pendiente") {
      return res.status(400).json({ error: "La cita no está en estado pendiente" });
    }

    const amountInCents = Math.round(monto * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: "mxn",
      metadata: { appointmentId, userId, appointmentTitle, monto: monto.toString() },
      payment_method_types: ["card"],
      description: `Pago cita NutriU: ${appointmentTitle || "Consulta Nutricional"}`,
    });

    console.log("[CREATE INTENT] Intent creado exitosamente:", paymentIntent.id);

    res.json({
      clientSecret: paymentIntent.client_secret,
      amount: monto,
      paymentIntentId: paymentIntent.id,  // ← Agregado: útil para frontend si necesitas confirm manual
    });
  } catch (err) {
    console.error("[CREATE INTENT] Error al crear intent:", err.message);
    res.status(500).json({ error: "Error interno al procesar pago" });
  }
});

// Ruta de confirmación manual (opcional, fallback si webhook falla)
router.post("/confirm-payment", async (req, res) => {
  try {
    const { paymentIntentId } = req.body;
    if (!paymentIntentId) {
      return res.status(400).json({ error: "paymentIntentId requerido" });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    if (paymentIntent.status !== "succeeded") {
      return res.status(400).json({ error: `Pago no exitoso (estado: ${paymentIntent.status})` });
    }

    const { userId, appointmentId, monto } = paymentIntent.metadata || {};

    // Registrar pago en Supabase
    const { error: pagoError } = await supabase.from("pagos").insert({
      id_cita: appointmentId || null,
      id_paciente: userId || null,
      monto: parseFloat(monto || paymentIntent.amount / 100),
      metodo_pago: "stripe",
      estado: "completado",
      stripe_payment_id: paymentIntentId,
      fecha_pago: new Date().toISOString(),
    });

    if (pagoError) {
      console.error("[CONFIRM] Error insertando pago:", pagoError.message);
      throw pagoError;
    }

    // Opcional: actualizar cita si no lo hizo el webhook
    if (appointmentId) {
      await supabase
        .from("citas")
        .update({ estado: "completada" })
        .eq("id_cita", appointmentId);
    }

    res.json({ success: true, message: "Pago confirmado y registrado" });
  } catch (err) {
    console.error("[CONFIRM] Error confirmando pago:", err.message);
    res.status(500).json({ error: "Error al confirmar pago" });
  }
});

module.exports = router;
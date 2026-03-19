const express = require("express");
const router = express.Router();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const supabase = require("../config/supabase"); // ← Ajusta la ruta: desde api/routes/ sube dos niveles
const {
  getCanjeRedemptionSummary,
  markCanjeAsUsed,
  parseCanjeMetadata,
} = require("./paymentCanjeUtils");

const formatCurrencyMXN = (value) =>
  Number(value || 0).toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const formatDateTimeMX = (value) => {
  if (!value) return "No disponible";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No disponible";
  return date.toLocaleString("es-MX", {
    timeZone: "America/Hermosillo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
};

const getReceiptDataByPaymentIntent = async (paymentIntentId) => {
  const { data: pagoData, error: pagoError } = await supabase
    .from("pagos")
    .select(
      "id_pago, monto, fecha_pago, estado, stripe_payment_id, id_cita, id_paciente, id_nutriologo",
    )
    .eq("stripe_payment_id", paymentIntentId)
    .maybeSingle();

  if (pagoError || !pagoData) {
    throw new Error(
      `No se encontró el pago asociado: ${pagoError?.message || "sin detalle"}`,
    );
  }

  const [
    { data: paciente, error: pacienteError },
    { data: nutriologo, error: nutriologoError },
    { data: cita, error: citaError },
  ] = await Promise.all([
    supabase
      .from("pacientes")
      .select("id_paciente, nombre, apellido, correo")
      .eq("id_paciente", pagoData.id_paciente)
      .maybeSingle(),
    supabase
      .from("nutriologos")
      .select("id_nutriologo, nombre, apellido, especialidad")
      .eq("id_nutriologo", pagoData.id_nutriologo)
      .maybeSingle(),
    supabase
      .from("citas")
      .select("id_cita, fecha_hora")
      .eq("id_cita", pagoData.id_cita)
      .maybeSingle(),
  ]);

  if (pacienteError) {
    throw new Error(`No se pudo cargar paciente: ${pacienteError.message}`);
  }
  if (nutriologoError) {
    throw new Error(`No se pudo cargar nutriólogo: ${nutriologoError.message}`);
  }
  if (citaError) {
    throw new Error(`No se pudo cargar cita: ${citaError.message}`);
  }

  const patientName = `${paciente?.nombre || ""} ${paciente?.apellido || ""}`
    .trim()
    .replace(/\s+/g, " ");
  const nutriologoName =
    `${nutriologo?.nombre || ""} ${nutriologo?.apellido || ""}`
      .trim()
      .replace(/\s+/g, " ");

  return {
    paymentIntentId,
    paymentId: pagoData.id_pago,
    amount: formatCurrencyMXN(pagoData.monto),
    paymentStatus: String(pagoData.estado || "completado"),
    paymentDate: formatDateTimeMX(pagoData.fecha_pago),
    appointmentDate: formatDateTimeMX(cita?.fecha_hora),
    patientName: patientName || "Paciente",
    patientEmail: paciente?.correo || "",
    nutriologoName: nutriologoName || "Nutriólogo",
    nutriologoSpecialty: nutriologo?.especialidad || "Nutrición",
  };
};

const finalizePaymentRecord = async (paymentIntentId) => {
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

  if (paymentIntent.status !== "succeeded") {
    return {
      success: false,
      status: paymentIntent.status,
      message: `Pago no exitoso (estado: ${paymentIntent.status})`,
    };
  }

  const metadata = paymentIntent.metadata || {};
  const { appointmentId } = metadata;

  if (!appointmentId) {
    throw new Error("appointmentId faltante en metadata");
  }

  const { data: citaData, error: citaError } = await supabase
    .from("citas")
    .select("id_cita, id_paciente, id_nutriologo")
    .eq("id_cita", appointmentId)
    .single();

  if (citaError || !citaData) {
    throw new Error(
      `No se encontro la cita asociada al pago: ${citaError?.message || "sin detalle"}`,
    );
  }

  const { data: existingPago, error: existingPagoError } = await supabase
    .from("pagos")
    .select("id_pago")
    .eq("stripe_payment_id", paymentIntentId)
    .maybeSingle();

  if (existingPagoError) {
    throw new Error(
      `Error consultando pago existente: ${existingPagoError.message}`,
    );
  }

  // Importante: pagar NO debe finalizar ni confirmar la cita.
  // La cita permanece en estado pendiente hasta que el nutriólogo la confirme.

  if (existingPago?.id_pago) {
    return { success: true, alreadyRegistered: true, citaData, paymentIntent };
  }

  const canjeMetadata = parseCanjeMetadata(metadata);
  const amountToSave =
    Number.isFinite(canjeMetadata.montoFinal) && canjeMetadata.montoFinal > 0
      ? canjeMetadata.montoFinal
      : paymentIntent.amount / 100;

  const { error: pagoError } = await supabase.from("pagos").insert({
    id_cita: citaData.id_cita,
    id_paciente: citaData.id_paciente,
    id_nutriologo: citaData.id_nutriologo,
    monto: amountToSave,
    metodo_pago: "stripe",
    estado: "completado",
    stripe_payment_id: paymentIntentId,
    fecha_pago: new Date().toISOString(),
  });

  if (pagoError) {
    throw new Error(`Error insertando pago: ${pagoError.message}`);
  }

  // Refuerzo de consistencia: cita pagada pero aun pendiente de confirmacion.
  const { error: citaStateError } = await supabase
    .from("citas")
    .update({ estado: "pendiente_pagado" })
    .eq("id_cita", citaData.id_cita)
    .in("estado", ["pendiente", "reprogramada"]);

  if (citaStateError) {
    throw new Error(
      `Error actualizando cita a pendiente_pagado: ${citaStateError.message}`,
    );
  }

  if (canjeMetadata.idCanjePaciente) {
    await markCanjeAsUsed({
      supabase,
      idCanjePaciente: canjeMetadata.idCanjePaciente,
      idCita: citaData.id_cita,
    });
  }

  return {
    success: true,
    alreadyRegistered: false,
    citaData,
    paymentIntent,
  };
};

// Crear Payment Intent
router.post("/create-payment-intent", async (req, res) => {
  try {
    const { appointmentId, userId, appointmentTitle, monto, idCanjePaciente } =
      req.body;

    console.log("[CREATE INTENT] Recibido:", {
      appointmentId,
      userId,
      monto,
      idCanjePaciente,
      title: appointmentTitle,
    });

    if (!appointmentId || !userId || !monto || monto <= 0) {
      return res
        .status(400)
        .json({ error: "appointmentId, userId y monto válido son requeridos" });
    }

    // Validación de cita (seguridad extra)
    const { data: cita, error: citaError } = await supabase
      .from("citas")
      .select("id_cita, id_paciente, id_nutriologo, estado")
      .eq("id_cita", appointmentId)
      .single();

    if (citaError || !cita) {
      console.error("[CREATE INTENT] Cita no encontrada:", citaError?.message);
      return res.status(404).json({ error: "Cita no encontrada o inválida" });
    }

    if (cita.estado !== "pendiente") {
      return res
        .status(400)
        .json({ error: "La cita no está en estado pendiente" });
    }

    if (Number(cita.id_paciente) !== Number(userId)) {
      return res
        .status(403)
        .json({ error: "La cita no pertenece al paciente autenticado" });
    }

    const canjeSummary = await getCanjeRedemptionSummary({
      supabase,
      idCanjePaciente,
      idPaciente: Number(userId),
      idNutriologo: Number(cita.id_nutriologo),
      tarifaConsulta: Number(monto),
    });

    const amountInCents = Math.round(canjeSummary.montoFinal * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: "mxn",
      metadata: {
        appointmentId,
        userId,
        appointmentTitle,
        monto: canjeSummary.montoFinal.toString(),
        montoOriginal: canjeSummary.montoOriginal.toString(),
        montoFinal: canjeSummary.montoFinal.toString(),
        descuentoAplicado: canjeSummary.descuentoAplicado.toString(),
        idCanjePaciente: canjeSummary.idCanjePaciente
          ? canjeSummary.idCanjePaciente.toString()
          : "",
        tipoCanje: canjeSummary.tipoCanje || "",
        canjeNombre: canjeSummary.canjeNombre || "",
      },
      payment_method_types: ["card"],
      description: `Pago cita NutriU: ${appointmentTitle || "Consulta Nutricional"}`,
    });

    console.log(
      "[CREATE INTENT] Intent creado exitosamente:",
      paymentIntent.id,
    );

    res.json({
      clientSecret: paymentIntent.client_secret,
      amount: canjeSummary.montoFinal,
      originalAmount: canjeSummary.montoOriginal,
      discountAmount: canjeSummary.descuentoAplicado,
      appliedCanje: canjeSummary.idCanjePaciente
        ? {
            idCanjePaciente: canjeSummary.idCanjePaciente,
            nombre: canjeSummary.canjeNombre,
            tipo: canjeSummary.tipoCanje,
          }
        : null,
      paymentIntentId: paymentIntent.id, // ← Agregado: útil para frontend si necesitas confirm manual
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

    const result = await finalizePaymentRecord(paymentIntentId);

    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }

    res.json({
      success: true,
      message: result.alreadyRegistered
        ? "Pago ya estaba registrado previamente"
        : "Pago confirmado y registrado",
      alreadyRegistered: Boolean(result.alreadyRegistered),
    });
  } catch (err) {
    console.error("[CONFIRM] Error confirmando pago:", err.message);
    res.status(500).json({ error: "Error al confirmar pago" });
  }
});

router.get("/receipt/:paymentIntentId", async (req, res) => {
  try {
    const paymentIntentId = String(req.params.paymentIntentId || "").trim();
    if (!paymentIntentId) {
      return res.status(400).json({ error: "paymentIntentId requerido" });
    }

    const receipt = await getReceiptDataByPaymentIntent(paymentIntentId);

    return res.json({
      success: true,
      receipt,
    });
  } catch (error) {
    return res.status(404).json({
      success: false,
      error: error.message || "No se pudo recuperar el comprobante",
    });
  }
});

router.finalizePaymentRecord = finalizePaymentRecord;

module.exports = router;

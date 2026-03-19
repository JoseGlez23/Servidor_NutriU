const MIN_PAYMENT_MXN = 1;

const roundCurrency = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const parseMetadataNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseCanjeMetadata = (metadata = {}) => {
  const idCanjePaciente = metadata.idCanjePaciente
    ? Number(metadata.idCanjePaciente)
    : null;

  return {
    idCanjePaciente,
    canjeNombre: metadata.canjeNombre || null,
    tipoCanje: metadata.tipoCanje || null,
    descuentoAplicado: roundCurrency(
      parseMetadataNumber(metadata.descuentoAplicado, 0),
    ),
    montoOriginal: roundCurrency(
      parseMetadataNumber(metadata.montoOriginal, metadata.monto || 0),
    ),
    montoFinal: roundCurrency(
      parseMetadataNumber(metadata.montoFinal, metadata.monto || 0),
    ),
  };
};

const inferDiscountPercent = (recompensa) => {
  const text = `${recompensa?.descripcion || ""} ${recompensa?.nombre || ""}`;
  const match = String(text).match(/(\d+(?:\.\d+)?)\s*%/);
  if (match) {
    return Number(match[1]);
  }
  return 10;
};

async function getCanjeRedemptionSummary({
  supabase,
  idCanjePaciente,
  idPaciente,
  idNutriologo,
  tarifaConsulta,
}) {
  const montoOriginal = roundCurrency(tarifaConsulta);

  if (!idCanjePaciente) {
    return {
      idCanjePaciente: null,
      montoOriginal,
      descuentoAplicado: 0,
      montoFinal: montoOriginal,
      tipoCanje: null,
      canjeNombre: null,
    };
  }

  const { data: canjePaciente, error } = await supabase
    .from("canje_recompensas")
    .select(
      `
      id_canje,
      id_paciente,
      id_recompensa,
      estado,
      recompensas(
        id_recompensa,
        nombre,
        descripcion,
        tipo_recompensa,
        activa
      )
    `,
    )
    .eq("id_canje", idCanjePaciente)
    .eq("id_paciente", idPaciente)
    .single();

  if (error || !canjePaciente) {
    throw new Error("El canje seleccionado no existe para este paciente");
  }

  if (canjePaciente.estado !== "pendiente") {
    throw new Error(
      `El canje ya no está disponible. Estado actual: ${canjePaciente.estado}`,
    );
  }

  const recompensa = canjePaciente.recompensas;
  if (!recompensa || recompensa.activa === false) {
    throw new Error("El canje seleccionado ya no está activo");
  }

  let descuentoAplicado = 0;
  let montoFinal = montoOriginal;

  if (recompensa.tipo_recompensa === "descuento") {
    const descuentoPercent = inferDiscountPercent(recompensa);
    const descuentoTeorico =
      montoOriginal * (Number(descuentoPercent || 0) / 100);
    const descuentoMaximo = Math.max(0, montoOriginal - MIN_PAYMENT_MXN);
    descuentoAplicado = roundCurrency(
      Math.min(descuentoTeorico, descuentoMaximo),
    );
    montoFinal = roundCurrency(montoOriginal - descuentoAplicado);
  } else {
    throw new Error("Esta recompensa no se puede aplicar como descuento");
  }

  if (montoFinal < MIN_PAYMENT_MXN) {
    throw new Error(
      "El canje dejaría la consulta por debajo del mínimo permitido de $1 MXN",
    );
  }

  return {
    idCanjePaciente: canjePaciente.id_canje,
    montoOriginal,
    descuentoAplicado,
    montoFinal,
    tipoCanje: recompensa.tipo_recompensa,
    canjeNombre: recompensa.nombre,
  };
}

async function markCanjeAsUsed({ supabase, idCanjePaciente, idCita }) {
  if (!idCanjePaciente) {
    return;
  }

  const { data: existing, error: existingError } = await supabase
    .from("canje_recompensas")
    .select("estado")
    .eq("id_canje", idCanjePaciente)
    .single();

  if (existingError || !existing) {
    throw new Error("No se pudo recuperar el canje aplicado");
  }

  if (existing.estado === "entregado") {
    return;
  }

  const { error: updateError } = await supabase
    .from("canje_recompensas")
    .update({
      estado: "entregado",
      fecha_entrega: new Date().toISOString(),
    })
    .eq("id_canje", idCanjePaciente);

  if (updateError) {
    throw new Error(
      `No se pudo marcar el canje como usado: ${updateError.message}`,
    );
  }
}

module.exports = {
  MIN_PAYMENT_MXN,
  parseCanjeMetadata,
  getCanjeRedemptionSummary,
  markCanjeAsUsed,
  roundCurrency,
};

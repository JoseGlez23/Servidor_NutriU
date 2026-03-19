// ════════════════════════════════════════════════════════════════
// EXCHANGE ROUTES: Gamification + Points Exchange System
//
// Handles:
// - Nutritionist management of point ranges
// - Creation and management of rewards/discounts (canjes)
// - Patient reward redemption during payment
// ════════════════════════════════════════════════════════════════

const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const { getCanjeRedemptionSummary } = require("./paymentCanjeUtils");

const findApplicableRange = (rangos = [], puntosTotales = 0) => {
  return (
    rangos.find(
      (rango) =>
        puntosTotales >= Number(rango.puntos_minimo || 0) &&
        (rango.puntos_maximo === null ||
          puntosTotales <= Number(rango.puntos_maximo)),
    ) || null
  );
};

// ────────────────────────────────────────────────────────────────
// RANGES (RANGOS_PUNTOS)
// ────────────────────────────────────────────────────────────────

/**
 * GET /ranges/:nutriologoId
 * Get all point ranges for a nutritionist
 */
router.get("/ranges/:nutriologoId", async (req, res) => {
  try {
    const { nutriologoId } = req.params;

    const { data, error } = await supabase
      .from("rangos_puntos")
      .select("*")
      .eq("id_nutriologo", nutriologoId)
      .eq("activo", true)
      .order("puntos_minimo", { ascending: true });

    if (error) throw error;

    res.json({ success: true, data });
  } catch (error) {
    console.error("[/ranges/:nutriologoId] Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /ranges
 * Create a new point range (nutritionist only)
 */
router.post("/ranges", async (req, res) => {
  try {
    const {
      id_nutriologo,
      nombre_rango,
      puntos_minimo,
      puntos_maximo,
      descripcion,
      icono_nivel,
    } = req.body;

    if (!id_nutriologo || !nombre_rango || puntos_minimo === undefined) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: id_nutriologo, nombre_rango, puntos_minimo",
      });
    }

    // Verify nutritionist exists
    const { data: nutriologo, error: errNutriologo } = await supabase
      .from("nutriologos")
      .select("id_nutriologo")
      .eq("id_nutriologo", id_nutriologo)
      .single();

    if (errNutriologo || !nutriologo) {
      return res.status(404).json({
        success: false,
        message: "Nutritionist not found",
      });
    }

    // Check for duplicate range name for this nutritionist
    const { data: existing } = await supabase
      .from("rangos_puntos")
      .select("id_rango")
      .eq("id_nutriologo", id_nutriologo)
      .eq("nombre_rango", nombre_rango)
      .single();

    if (existing) {
      return res.status(409).json({
        success: false,
        message: "Range name already exists for this nutritionist",
      });
    }

    const { data, error } = await supabase
      .from("rangos_puntos")
      .insert({
        id_nutriologo,
        nombre_rango,
        puntos_minimo,
        puntos_maximo: puntos_maximo || null,
        descripcion: descripcion || null,
        icono_nivel: icono_nivel || nombre_rango.toLowerCase(),
        activo: true,
      })
      .select();

    if (error) throw error;

    res.status(201).json({ success: true, data: data[0] });
  } catch (error) {
    console.error("[POST /ranges] Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /ranges/:idRango
 * Update a point range
 */
router.put("/ranges/:idRango", async (req, res) => {
  try {
    const { idRango } = req.params;
    const {
      nombre_rango,
      puntos_minimo,
      puntos_maximo,
      descripcion,
      icono_nivel,
      activo,
    } = req.body;

    const updateData = { actualizado_en: new Date().toISOString() };
    if (nombre_rango !== undefined) updateData.nombre_rango = nombre_rango;
    if (puntos_minimo !== undefined) updateData.puntos_minimo = puntos_minimo;
    if (puntos_maximo !== undefined) updateData.puntos_maximo = puntos_maximo;
    if (descripcion !== undefined) updateData.descripcion = descripcion;
    if (icono_nivel !== undefined) updateData.icono_nivel = icono_nivel;
    if (activo !== undefined) updateData.activo = activo;

    const { data, error } = await supabase
      .from("rangos_puntos")
      .update(updateData)
      .eq("id_rango", idRango)
      .select();

    if (error) throw error;
    if (!data || data.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Range not found" });
    }

    res.json({ success: true, data: data[0] });
  } catch (error) {
    console.error("[PUT /ranges/:idRango] Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ────────────────────────────────────────────────────────────────
// CANJES (REWARDS/DISCOUNTS)
// ────────────────────────────────────────────────────────────────

/**
 * GET /canjes/:nutriologoId
 * Get all canjes for a nutritionist
 */
router.get("/canjes/:nutriologoId", async (req, res) => {
  try {
    const { nutriologoId } = req.params;

    const { data, error } = await supabase
      .from("canjes")
      .select(
        `
        *,
        rangos_puntos(nombre_rango, puntos_minimo, puntos_maximo)
      `,
      )
      .eq("id_nutriologo", nutriologoId)
      .eq("activo", true)
      .order("creado_en", { ascending: false });

    if (error) throw error;

    res.json({ success: true, data });
  } catch (error) {
    console.error("[GET /canjes/:nutriologoId] Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /canjes
 * Create a new canje (nutritionist only)
 */
router.post("/canjes", async (req, res) => {
  try {
    const {
      id_nutriologo,
      id_rango,
      nombre_canje,
      tipo_canje,
      valor_descuento,
      cantidad_consultas,
      descripcion,
      monto_minimo_consulta,
    } = req.body;

    if (!id_nutriologo || !id_rango || !nombre_canje || !tipo_canje) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: id_nutriologo, id_rango, nombre_canje, tipo_canje",
      });
    }

    if (!["descuento", "consulta_gratis"].includes(tipo_canje)) {
      return res.status(400).json({
        success: false,
        message: 'tipo_canje must be "descuento" or "consulta_gratis"',
      });
    }

    // Validate discount range
    if (tipo_canje === "descuento") {
      if (
        valor_descuento === undefined ||
        valor_descuento < 0 ||
        valor_descuento > 100
      ) {
        return res.status(400).json({
          success: false,
          message: "For descuento type, valor_descuento must be 0-100",
        });
      }
    }

    const { data, error } = await supabase
      .from("canjes")
      .insert({
        id_nutriologo,
        id_rango,
        nombre_canje,
        tipo_canje,
        valor_descuento: tipo_canje === "descuento" ? valor_descuento : null,
        cantidad_consultas:
          tipo_canje === "consulta_gratis" ? cantidad_consultas || 1 : null,
        descripcion: descripcion || null,
        monto_minimo_consulta: monto_minimo_consulta || null,
        activo: true,
      })
      .select();

    if (error) throw error;

    res.status(201).json({ success: true, data: data[0] });
  } catch (error) {
    console.error("[POST /canjes] Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /canjes/:idCanje
 * Update a canje
 */
router.put("/canjes/:idCanje", async (req, res) => {
  try {
    const { idCanje } = req.params;
    const {
      nombre_canje,
      tipo_canje,
      valor_descuento,
      cantidad_consultas,
      descripcion,
      monto_minimo_consulta,
      activo,
    } = req.body;

    const updateData = { actualizado_en: new Date().toISOString() };
    if (nombre_canje !== undefined) updateData.nombre_canje = nombre_canje;
    if (tipo_canje !== undefined) updateData.tipo_canje = tipo_canje;
    if (valor_descuento !== undefined)
      updateData.valor_descuento = valor_descuento;
    if (cantidad_consultas !== undefined)
      updateData.cantidad_consultas = cantidad_consultas;
    if (descripcion !== undefined) updateData.descripcion = descripcion;
    if (monto_minimo_consulta !== undefined)
      updateData.monto_minimo_consulta = monto_minimo_consulta;
    if (activo !== undefined) updateData.activo = activo;

    const { data, error } = await supabase
      .from("canjes")
      .update(updateData)
      .eq("id_canje", idCanje)
      .select();

    if (error) throw error;
    if (!data || data.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Canje not found" });
    }

    res.json({ success: true, data: data[0] });
  } catch (error) {
    console.error("[PUT /canjes/:idCanje] Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ────────────────────────────────────────────────────────────────
// PATIENT CANJES MANAGEMENT
// ────────────────────────────────────────────────────────────────

/**
 * GET /paciente/:pacienteId/canjes-disponibles
 * Get all available canjes for a patient
 * Returns canjes grouped by state: available, used, expired
 */
router.get("/paciente/:pacienteId/canjes-disponibles", async (req, res) => {
  try {
    const { pacienteId } = req.params;
    const nutriologoIdFromQuery = req.query.nutriologoId
      ? Number(req.query.nutriologoId)
      : null;

    // Get patient's current points and nutritionist
    const { data: pacientePuntos, error: errPuntos } = await supabase
      .from("puntos_paciente")
      .select("puntos_totales")
      .eq("id_paciente", pacienteId)
      .single();

    if (errPuntos || !pacientePuntos) {
      return res
        .status(404)
        .json({ success: false, message: "Patient or points not found" });
    }

    let id_nutriologo = nutriologoIdFromQuery;

    if (!id_nutriologo) {
      const { data: relacion, error: errRelacion } = await supabase
        .from("paciente_nutriologo")
        .select("id_nutriologo")
        .eq("id_paciente", pacienteId)
        .eq("activo", true)
        .single();

      if (errRelacion || !relacion) {
        return res
          .status(404)
          .json({ success: false, message: "No active nutritionist assigned" });
      }

      id_nutriologo = relacion.id_nutriologo;
    }

    const puntosTotales = pacientePuntos.puntos_totales;

    // Get all ranges for the nutritionist
    const { data: rangos, error: errRangos } = await supabase
      .from("rangos_puntos")
      .select("id_rango, nombre_rango, puntos_minimo, puntos_maximo")
      .eq("id_nutriologo", id_nutriologo)
      .eq("activo", true)
      .order("puntos_minimo", { ascending: true });

    if (errRangos) throw errRangos;

    // Find current range
    const rangoActual = findApplicableRange(rangos || [], puntosTotales);

    // Get available canjes for patient's current range
    let canjesDisponibles = [];
    if (rangoActual?.id_rango) {
      const { data: canjesDelRango, error: errCanjesDelRango } = await supabase
        .from("canjes")
        .select("id_canje")
        .eq("id_nutriologo", id_nutriologo)
        .eq("id_rango", rangoActual.id_rango)
        .eq("activo", true);

      if (errCanjesDelRango) throw errCanjesDelRango;

      const idsCanjes = (canjesDelRango || []).map((item) => item.id_canje);

      if (idsCanjes.length > 0) {
        const { data: canjes, error: errCanjes } = await supabase
          .from("canjes_paciente")
          .select(
            `
          *,
          canjes(id_canje, id_rango, nombre_canje, tipo_canje, valor_descuento, cantidad_consultas, descripcion, monto_minimo_consulta)
        `,
          )
          .eq("id_paciente", pacienteId)
          .eq("estado", "disponible")
          .in("id_canje", idsCanjes)
          .order("fecha_obtenido", { ascending: false });

        if (errCanjes) throw errCanjes;
        canjesDisponibles = canjes || [];
      }
    }

    // Get all canjes earned by patient (for history)
    const { data: historialCanjes, error: errHistorial } = await supabase
      .from("canjes_paciente")
      .select(
        `
        *,
        canjes(id_canje, id_rango, nombre_canje, tipo_canje, valor_descuento, cantidad_consultas, descripcion, monto_minimo_consulta)
      `,
      )
      .eq("id_paciente", pacienteId)
      .order("fecha_obtenido", { ascending: false });

    if (errHistorial) throw errHistorial;

    res.json({
      success: true,
      data: {
        puntosTotales,
        rangoActual: rangoActual ? rangoActual.id_rango : null,
        rangoDetalle: rangoActual,
        idNutriologo: id_nutriologo,
        canjesDisponibles,
        historialCanjes: historialCanjes || [],
      },
    });
  } catch (error) {
    console.error(
      "[GET /paciente/:pacienteId/canjes-disponibles] Error:",
      error.message,
    );
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /redeem
 * Preview a canje during appointment payment without consuming it
 */
router.post("/redeem", async (req, res) => {
  try {
    const { id_canje_paciente, id_paciente, id_nutriologo, tarifa_consulta } =
      req.body;

    if (
      !id_canje_paciente ||
      !id_paciente ||
      !id_nutriologo ||
      tarifa_consulta === undefined
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: id_canje_paciente, id_paciente, id_nutriologo, tarifa_consulta",
      });
    }

    const tarifaNum = Number(tarifa_consulta);
    if (isNaN(tarifaNum) || tarifaNum <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid tarifa_consulta",
      });
    }

    const summary = await getCanjeRedemptionSummary({
      supabase,
      idCanjePaciente: Number(id_canje_paciente),
      idPaciente: Number(id_paciente),
      idNutriologo: Number(id_nutriologo),
      tarifaConsulta: tarifaNum,
    });

    res.json({
      success: true,
      data: {
        id_canje_paciente: summary.idCanjePaciente,
        canje_aplicado: summary.canjeNombre,
        tipo_canje: summary.tipoCanje,
        descuento_aplicado: summary.descuentoAplicado,
        monto_original: summary.montoOriginal,
        monto_final: summary.montoFinal,
      },
    });
  } catch (error) {
    console.error("[POST /redeem] Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /check-and-award-canjes
 * Check if patient reached new range and award canjes
 * Called after points update
 */
router.post("/check-and-award-canjes", async (req, res) => {
  try {
    const { id_paciente, puntos_totales } = req.body;

    if (!id_paciente || puntos_totales === undefined) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: id_paciente, puntos_totales",
      });
    }

    // Get patient's nutritionist
    const { data: relacion, error: errRelacion } = await supabase
      .from("paciente_nutriologo")
      .select("id_nutriologo")
      .eq("id_paciente", id_paciente)
      .eq("activo", true)
      .single();

    if (errRelacion || !relacion) {
      return res
        .status(404)
        .json({ success: false, message: "No active nutritionist" });
    }

    const { data: rangos, error: errRangos } = await supabase
      .from("rangos_puntos")
      .select("id_rango, nombre_rango, puntos_minimo, puntos_maximo")
      .eq("id_nutriologo", relacion.id_nutriologo)
      .eq("activo", true)
      .order("puntos_minimo", { ascending: true });

    if (errRangos) throw errRangos;

    const rango = findApplicableRange(rangos || [], Number(puntos_totales));

    if (!rango) {
      return res.json({
        success: true,
        message: "No applicable range",
        awarded: [],
      });
    }

    // Get canjes for this range
    const { data: canjes, error: errCanjes } = await supabase
      .from("canjes")
      .select("id_canje")
      .eq("id_rango", rango.id_rango)
      .eq("activo", true);

    if (errCanjes) throw errCanjes;

    // Award each canje if patient doesn't already have it
    const awarded = [];
    for (const canje of canjes || []) {
      const { data: existing } = await supabase
        .from("canjes_paciente")
        .select("id_canje_paciente")
        .eq("id_paciente", id_paciente)
        .eq("id_canje", canje.id_canje)
        .single();

      if (!existing) {
        const { data: newCanje, error: errInsert } = await supabase
          .from("canjes_paciente")
          .insert({
            id_paciente,
            id_canje: canje.id_canje,
            id_nutriologo: relacion.id_nutriologo,
            estado: "disponible",
          })
          .select();

        if (!errInsert && newCanje) {
          awarded.push(newCanje[0]);
        }
      }
    }

    res.json({
      success: true,
      data: {
        rango_alcanzado: rango.nombre_rango,
        canjes_award: awarded,
      },
    });
  } catch (error) {
    console.error("[POST /check-and-award-canjes] Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

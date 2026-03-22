const express = require("express");
const supabase = require("../config/supabase");
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const router = express.Router();

router.post("/custom", async (req, res) => {
  try {
    const { pacienteId, titulo, mensaje, datosAdicionales, tipo } =
      req.body || {};
    if (!pacienteId || !titulo || !mensaje) {
      return res.status(400).json({
        success: false,
        error: "pacienteId, titulo y mensaje son requeridos",
      });
    }

    const { error: dbNotifError } = await supabase
      .from("notificaciones")
      .insert({
        id_usuario: pacienteId,
        tipo_usuario: "paciente",
        titulo,
        mensaje,
        tipo: tipo || "canje",
        leida: false,
        fecha_envio: new Date().toISOString(),
        datos_adicionales: datosAdicionales || {},
      });

    const { data: tokens } = await supabase
      .from("push_tokens")
      .select("token")
      .eq("id_paciente", pacienteId)
      .eq("is_active", true);

    if (tokens && tokens.length > 0) {
      const validTokens = tokens.filter((t) => isValidExpoPushToken(t.token));
      if (validTokens.length > 0) {
        const messages = validTokens.map((t) => ({
          to: t.token,
          sound: "default",
          title: titulo,
          body: mensaje,
          data: {
            ...datosAdicionales,
            tipo: tipo || "canje",
            timestamp: new Date().toISOString(),
          },
          badge: 1,
          priority: "high",
          channelId: "default",
        }));
        await sendPushNotifications(messages);
      }
    }

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}); 

/**
 * Valida que un token tenga el formato correcto de Expo
 * @param {string} pushToken - Token a validar
 * @returns {boolean}
 */
function isValidExpoPushToken(pushToken) {
  return (
    pushToken &&
    (pushToken.startsWith("ExponentPushToken[") ||
      pushToken.startsWith("ExpoPushToken["))
  );
}

async function notifyPatientDevices({
  pacienteId,
  titulo,
  mensaje,
  data,
  tipo = "sistema",
}) {
  const nowIso = new Date().toISOString();

  const { error: dbNotifError } = await supabase.from("notificaciones").insert({
    id_usuario: pacienteId,
    tipo_usuario: "paciente",
    titulo,
    mensaje,
    tipo,
    leida: false,
    fecha_envio: nowIso,
    datos_adicionales: data,
  });

  const { data: tokens, error: tokenError } = await supabase
    .from("push_tokens")
    .select("token")
    .eq("id_paciente", pacienteId)
    .eq("is_active", true);

  if (tokenError) {
    return { sent: 0, savedInDB: !dbNotifError };
  }

  const validTokens = (tokens || []).filter((t) =>
    isValidExpoPushToken(t.token),
  );
  if (validTokens.length === 0) {
    return { sent: 0, savedInDB: !dbNotifError };
  }

  const messages = validTokens.map((t) => ({
    to: t.token,
    sound: "default",
    title: titulo,
    body: mensaje,
    data: {
      ...(data || {}),
      timestamp: nowIso,
    },
    badge: 1,
    priority: "high",
    channelId: "default",
  }));

  await sendPushNotifications(messages);

  return {
    sent: validTokens.length,
    savedInDB: !dbNotifError,
  };
}

router.post("/appointment-status", async (req, res) => {
  try {
    const { pacienteId, idCita, fechaCita, nutriologoNombre, status } =
      req.body || {};

    if (!pacienteId || !idCita || !status) {
      return res.status(400).json({
        success: false,
        error: "pacienteId, idCita y status son requeridos",
      });
    }

    const normalizedStatus = String(status).trim().toLowerCase();
    if (!["confirmed", "completed"].includes(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        error: "status debe ser 'confirmed' o 'completed'",
      });
    }

    const isConfirmed = normalizedStatus === "confirmed";
    const titulo = isConfirmed ? "✅ Cita confirmada" : "🏁 Cita finalizada";

    const fechaTexto = fechaCita
      ? new Date(fechaCita).toLocaleString("es-MX", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

    const mensaje = isConfirmed
      ? `${nutriologoNombre || "Tu nutriólogo"} confirmó tu cita${fechaTexto ? ` del ${fechaTexto}` : ""}.`
      : `${nutriologoNombre || "Tu nutriólogo"} finalizó tu cita${fechaTexto ? ` del ${fechaTexto}` : ""}.`;

    const data = {
      type: isConfirmed ? "appointment_confirmed" : "appointment_completed",
      subtipo: isConfirmed ? "appointment_confirmed" : "appointment_completed",
      idCita,
      fechaCita: fechaCita || null,
      nutriologoNombre: nutriologoNombre || null,
      status: isConfirmed ? "confirmada" : "completada",
    };

    const { data: tokens } = await supabase
      .from("push_tokens")
      .select("token")
      .eq("id_paciente", pacienteId)
      .eq("is_active", true);

    if (tokens && tokens.length > 0) {
      const validTokens = tokens.filter((t) => isValidExpoPushToken(t.token));
      if (validTokens.length > 0) {
        const messages = validTokens.map((t) => ({
          to: t.token,
          sound: "default",
          title: titulo,
          body: mensaje,
          data: {
            ...datosAdicionales,
            tipo: tipo || "canje",
            timestamp: new Date().toISOString(),
          },
          badge: 1,
          priority: "high",
          channelId: "default",
        }));
        await sendPushNotifications(messages);
      }
    }

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/appointment-request", async (req, res) => {
  try {
    const { pacienteId, nutriologoNombre, fechaCita, idCita } = req.body;

    if (!pacienteId || !nutriologoNombre || !fechaCita || !idCita) {
      return res.status(400).json({
        success: false,
        error: "Faltan campos requeridos",
      });
    }

    const tituloNotif = "📅 Nueva cita agendada";
    const mensajeNotif = `${nutriologoNombre} ha agendado una cita para el ${new Date(fechaCita).toLocaleDateString("es-MX")}. ¿Aceptas?`;

    const { error: dbNotifError } = await supabase
      .from("notificaciones")
      .insert({
        id_usuario: pacienteId,
        tipo_usuario: "paciente",
        titulo: tituloNotif,
        mensaje: mensajeNotif,
        tipo: "cita",
        leida: false,
        fecha_envio: new Date().toISOString(),
        datos_adicionales: {
          tipo: "appointment_request",
          idCita,
          fechaCita,
          nutriologoNombre,
          requiereRespuesta: true,
        },
      });

    const { data: tokens } = await supabase
      .from("push_tokens")
      .select("token")
      .eq("id_paciente", pacienteId)
      .eq("is_active", true);

    if (tokens && tokens.length > 0) {
      const validTokens = tokens.filter((t) => isValidExpoPushToken(t.token));

      if (validTokens.length > 0) {
        const messages = validTokens.map((t) => ({
          to: t.token,
          sound: "default",
          title: tituloNotif,
          body: mensajeNotif,
          data: {
            type: "appointment_request",
            pacienteId,
            idCita,
            timestamp: new Date().toISOString(),
          },
          badge: 1,
          priority: "high",
        }));

        await sendPushNotifications(messages);
      }
    }

    return res.json({ success: true, savedInDB: !dbNotifError });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/points-awarded", async (req, res) => {
  try {
    const { pacienteId, puntos, motivo } = req.body;

    if (!pacienteId || !puntos) {
      return res.status(400).json({
        success: false,
        error: "pacienteId y puntos son requeridos",
      });
    }

    const tituloNotif = "¡Puntos obtenidos!";
    const mensajeNotif = `Has ganado ${puntos} puntos${motivo ? ` por ${motivo}` : ""}. ¡Sigue así!`;

    const { error: dbNotifError } = await supabase
      .from("notificaciones")
      .insert({
        id_usuario: pacienteId,
        tipo_usuario: "paciente",
        titulo: tituloNotif,
        mensaje: mensajeNotif,
        tipo: "sistema",
        leida: false,
        fecha_envio: new Date().toISOString(),
        datos_adicionales: {
          tipo: "points_awarded",
          puntos,
          motivo: motivo || null,
        },
      });

    const { data: tokens } = await supabase
      .from("push_tokens")
      .select("token")
      .eq("id_paciente", pacienteId)
      .eq("is_active", true);

    if (tokens && tokens.length > 0) {
      const validTokens = tokens.filter((t) => isValidExpoPushToken(t.token));

      if (validTokens.length > 0) {
        const messages = validTokens.map((t) => ({
          to: t.token,
          sound: "default",
          title: tituloNotif,
          body: mensajeNotif,
          data: {
            type: "points_awarded",
            pacienteId,
            puntos,
            timestamp: new Date().toISOString(),
          },
        }));

        await sendPushNotifications(messages);
      }
    }

    return res.json({ success: true, savedInDB: !dbNotifError });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/register-token", async (req, res) => {
  try {
    const { pacienteId, token, deviceType = "mobile" } = req.body;

    if (!pacienteId || !token) {
      return res.status(400).json({
        success: false,
        error: "pacienteId y token son requeridos",
      });
    }

    if (!isValidExpoPushToken(token)) {
      return res.status(400).json({
        success: false,
        error: "Token de Expo no válido",
      });
    }

    const { data: paciente, error: pacienteError } = await supabase
      .from("pacientes")
      .select("id_paciente")
      .eq("id_paciente", pacienteId)
      .single();

    if (pacienteError || !paciente) {
      return res.status(404).json({
        success: false,
        error: "Paciente no encontrado",
      });
    }

    const { data, error } = await supabase
      .from("push_tokens")
      .upsert(
        {
          id_paciente: pacienteId,
          token,
          device_type: deviceType,
          is_active: true,
          last_used: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "id_paciente,token",
          ignoreDuplicates: false,
        },
      )
      .select();

    if (error) {
      return res.status(500).json({
        success: false,
        error: "Error al registrar token",
      });
    }


    return res.json({
      success: true,
      message: "Token registrado correctamente",
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

router.delete("/remove-token", async (req, res) => {
  try {
    const { pacienteId, token } = req.body;

    if (!pacienteId || !token) {
      return res.status(400).json({
        success: false,
        error: "pacienteId y token son requeridos",
      });
    }

    const { error } = await supabase
      .from("push_tokens")
      .update({ is_active: false })
      .eq("id_paciente", pacienteId)
      .eq("token", token);

    if (error) {
      return res.status(500).json({
        success: false,
        error: "Error al eliminar token",
      });
    }

    return res.json({
      success: true,
      message: "Token desactivado correctamente",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

router.post("/test", async (req, res) => {
  try {
    const { pacienteId } = req.body;

    if (!pacienteId) {
      return res.status(400).json({
        success: false,
        error: "pacienteId es requerido",
      });
    }

    const { data: tokens } = await supabase
      .from("push_tokens")
      .select("token")
      .eq("id_paciente", pacienteId)
      .eq("is_active", true);

    if (!tokens || tokens.length === 0) {
      return res.status(200).json({
        success: false,
        message: "No hay dispositivos registrados",
      });
    }

    const validTokens = tokens.filter((t) => isValidExpoPushToken(t.token));

    const messages = validTokens.map((t) => ({
      to: t.token,
      sound: "default",
      title: "Notificación de prueba",
      body: "¡Tu sistema de notificaciones está funcionando correctamente!",
      data: { type: "test" },
    }));

    const result = await sendPushNotifications(messages);

    return res.json({
      success: true,
      sent: validTokens.length,
      result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

async function sendPushNotifications(messages) {
  return { success: true, messagesSent: messages.length };
}

router.post("/diet-updated", async (req, res) => {
  try {
    const {
      pacienteId,
      nutriologoNombre,
      dietaNombre,
      action,
      mealUpdatedLabel,
      dayUpdatedLabel,
    } = req.body || {};
    if (!pacienteId || !action) {
      return res.status(400).json({
        success: false,
        error: "pacienteId y action son requeridos",
      });
    }

    const isUpdate = action === "updated";
    const titulo = isUpdate ? "Plan actualizado" : "Nuevo plan asignado";
    let mensaje = nutriologoNombre
      ? `Tu nutriólogo ${nutriologoNombre} ${isUpdate ? "actualizó" : "asignó"} tu plan nutricional${dietaNombre ? `: ${dietaNombre}` : "."}`
      : `Se ${isUpdate ? "actualizó" : "asignó"} tu plan nutricional${dietaNombre ? `: ${dietaNombre}` : "."}`;
    if (mealUpdatedLabel || dayUpdatedLabel) {
      mensaje += ` (${[mealUpdatedLabel, dayUpdatedLabel].filter(Boolean).join(", ")})`;
    }

    const { error: dbNotifError } = await supabase
      .from("notificaciones")
      .insert({
        id_usuario: pacienteId,
        tipo_usuario: "paciente",
        titulo,
        mensaje,
        tipo: "sistema",
        leida: false,
        fecha_envio: new Date().toISOString(),
        datos_adicionales: {
          tipo: "diet_updated",
          action,
          dietaNombre: dietaNombre || null,
          mealUpdatedLabel: mealUpdatedLabel || null,
          dayUpdatedLabel: dayUpdatedLabel || null,
        },
      });

    const { data: tokens } = await supabase
      .from("push_tokens")
      .select("token")
      .eq("id_paciente", pacienteId)
      .eq("is_active", true);

    if (tokens && tokens.length > 0) {
      const validTokens = tokens.filter((t) => isValidExpoPushToken(t.token));
      if (validTokens.length > 0) {
        const messages = validTokens.map((t) => ({
          to: t.token,
          sound: "default",
          title: titulo,
          body: mensaje,
          data: {
            tipo: "diet_updated",
            action,
            dietaNombre: dietaNombre || null,
            mealUpdatedLabel: mealUpdatedLabel || null,
            dayUpdatedLabel: dayUpdatedLabel || null,
            timestamp: new Date().toISOString(),
          },
          badge: 1,
          priority: "high",
          channelId: "default",
        }));
        await sendPushNotifications(messages);
      }
    }

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

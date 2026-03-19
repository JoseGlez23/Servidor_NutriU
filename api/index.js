const express = require("express");
const cors = require("cors");
require("dotenv").config();

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const supabase = require("../config/supabase"); // ← Ajusta si config está fuera de api/

const app = express();

// Middlewares
app.use(
  cors({
    origin: "*",
    credentials: true,
  }),
);

app.use(express.json());

// Health check (útil para probar que el servidor responde)
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    message: "Servidor Stripe para NutriU funcionando",
    timestamp: new Date().toISOString(),
  });
});

// Rutas de pagos (tu paymentRoutes)
const paymentRoutes = require("./paymentRoutes");
const { finalizePaymentRecord } = paymentRoutes;
app.use("/payments", paymentRoutes);

// Rutas de notificaciones push
const notificationRoutes = require("./notificationRoutes");
app.use("/notifications", notificationRoutes);

// Rutas de canjes (rewards/discounts y gamificación)
const exchangeRoutes = require("./exchangeRoutes");
app.use("/exchange", exchangeRoutes);

// Webhook (mantengo tu lógica exacta, solo quito ngrok y agrego logs claros)
app.post(
  "/webhook-nutriu",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET; // ← Cambié a STRIPE_WEBHOOK_SECRET (sin _NUTRIU, ajusta si usas otro nombre)

    if (!webhookSecret) {
      console.error(
        "[WEBHOOK] Falta STRIPE_WEBHOOK_SECRET en variables de entorno",
      );
      return res.status(500).send("Webhook secret no configurada");
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error("[WEBHOOK] Firma inválida:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Manejo del evento de pago exitoso
    if (event.type === "payment_intent.succeeded") {
      const paymentIntent = event.data.object;
      const { appointmentId, monto } = paymentIntent.metadata || {};

      console.log(
        `[WEBHOOK] Pago confirmado - Cita: ${appointmentId || "sin ID"}, Monto: ${monto || "sin monto"}`,
      );

      try {
        if (!appointmentId) {
          throw new Error("appointmentId faltante en metadata");
        }

        const result = await finalizePaymentRecord(paymentIntent.id);
        if (result?.alreadyRegistered) {
          return res.json({ received: true, alreadyRegistered: true });
        }
      } catch (dbErr) {
        console.error("[WEBHOOK] Error actualizando Supabase:", dbErr.message);
        // No retornamos error a Stripe, solo logueamos (Stripe reintentará si falla)
      }
    }

    // Siempre responde 200 OK a Stripe (obligatorio)
    res.json({ received: true });
  },
);

// ¡IMPORTANTE! Exporta la app para Vercel (sin app.listen)
module.exports = app;

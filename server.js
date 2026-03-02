const express = require("express");
const cors = require("cors");
require("dotenv").config();

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const supabase = require("./config/supabase");

const app = express();
const PORT = process.env.PORT || 4243;

app.use((req, res, next) => {
  res.setHeader("ngrok-skip-browser-warning", "true");
  next();
});

app.use(
  cors({
    origin: "*",
    credentials: true,
  }),
);

app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    message: "Servidor Stripe para NutriU funcionando",
    timestamp: new Date().toISOString(),
  });
});

// Rutas
const paymentRoutes = require("./routes/paymentRoutes");
app.use("/payments", paymentRoutes);

// Webhook (ya lo tienes bien, no necesita cambios)
app.post(
  "/webhook-nutriu",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET_NUTRIU;

    if (!webhookSecret) {
      console.error("[WEBHOOK] Falta STRIPE_WEBHOOK_SECRET_NUTRIU");
      return res.status(500).send("Webhook secret no configurada");
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error("[WEBHOOK] Firma inválida:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "payment_intent.succeeded") {
      const paymentIntent = event.data.object;
      const { appointmentId, userId, monto } = paymentIntent.metadata;

      console.log(
        `[WEBHOOK] Pago OK - Cita: ${appointmentId}, User: ${userId}, Monto: ${monto}`,
      );

      try {
        await supabase
          .from("citas")
          .update({ estado: "completada" })
          .eq("id_cita", appointmentId);

        await supabase.from("pagos").insert({
          id_cita: appointmentId,
          id_paciente: userId,
          monto: parseFloat(monto),
          metodo_pago: "stripe",
          estado: "completado",
          stripe_payment_id: paymentIntent.id,
          fecha_pago: new Date().toISOString(),
        });
      } catch (dbErr) {
        console.error("[WEBHOOK] Error en BD:", dbErr.message);
      }
    }

    res.json({ received: true });
  },
);

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
  console.log(`Webhook: https://tu-ngrok-url.ngrok-free.app/webhook-nutriu`);
});

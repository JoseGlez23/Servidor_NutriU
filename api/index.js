const express = require("express");
const cors = require("cors");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const supabase = require("../config/supabase");
const app = express();
app.use(cors({ origin: "*", credentials: true }));
app.use(express.json());
app.get("/health", (req, res) => {
  res.json({ status: "OK" });
});
const paymentRoutes = require("./paymentRoutes");
const { finalizePaymentRecord } = paymentRoutes;
app.use("/payments", paymentRoutes);
const notificationRoutes = require("./notificationRoutes");
app.use("/notifications", notificationRoutes);
const exchangeRoutes = require("./exchangeRoutes");
app.use("/exchange", exchangeRoutes);
app.post(
  "/webhook-nutriu",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return res.status(500).send("Webhook secret no configurada");
    }
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    if (event.type === "payment_intent.succeeded") {
      const paymentIntent = event.data.object;
      const { appointmentId } = paymentIntent.metadata || {};
      try {
        if (!appointmentId) {
          throw new Error("appointmentId faltante en metadata");
        }
        const result = await finalizePaymentRecord(paymentIntent.id);
        if (result?.alreadyRegistered) {
          return res.json({ received: true, alreadyRegistered: true });
        }
      } catch (dbErr) {
        // Error al actualizar Supabase
      }
    }
    res.json({ received: true });
  },
);
module.exports = app;

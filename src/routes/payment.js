// Payment Routes for NTC
// Handles Stripe payment intents, confirmations, webhooks, payment history, and invoices

const express = require("express");
const admin = require("firebase-admin");
const { verifyToken } = require("../auth");
const { requireRole, ROLES } = require("../middleware/rbac");
const paymentService = require("../services/paymentService");
const emailService = require("../services/emailService");
const { cache, TTL } = require("../services/cache");

const router = express.Router();

// ============================================
// USER PAYMENT ENDPOINTS
// ============================================

// POST /api/payments/create-intent — Create a payment intent for a document submission
router.post("/create-intent", verifyToken, async (req, res) => {
  try {
    const { certDocId, speedTier, formType, documentTitle } = req.body;

    if (!certDocId || !speedTier) {
      return res
        .status(400)
        .json({ error: "certDocId and speedTier are required" });
    }

    // Validate speed tier
    if (!["standard", "rush", "express"].includes(speedTier)) {
      return res.status(400).json({ error: "Invalid speed tier" });
    }

    // Verify the certified document belongs to this user
    const db = admin.firestore();
    const certDoc = await db
      .collection("certifiedDocuments")
      .doc(certDocId)
      .get();

    if (!certDoc.exists) {
      return res.status(404).json({ error: "Document not found" });
    }

    if (certDoc.data().userId !== req.user.uid) {
      return res.status(403).json({ error: "Not authorized" });
    }

    // Check if already paid (succeeded)
    const existingPayment =
      await paymentService.getPaymentForDocument(certDocId);
    if (existingPayment) {
      return res.status(400).json({
        error: "Document has already been paid for",
        paymentId: existingPayment.id,
      });
    }

    // createPaymentIntent is idempotent — returns existing pending intent if one exists
    const result = await paymentService.createPaymentIntent({
      userId: req.user.uid,
      userEmail: req.user.email,
      certDocId,
      speedTier,
      formType: formType || certDoc.data().formType,
      documentTitle:
        documentTitle || certDoc.data().originalData?.studentName || certDocId,
    });

    res.json({ success: true, ...result });
  } catch (error) {
    console.error("🚨 Create payment intent error:", error.message);
    res.status(500).json({ error: "Failed to create payment" });
  }
});

// POST /api/payments/confirm — Confirm payment after frontend Stripe confirmation
// This is a backup to the webhook — ensures we capture payment even if webhook is delayed
router.post("/confirm", verifyToken, async (req, res) => {
  try {
    const { paymentIntentId } = req.body;

    if (!paymentIntentId) {
      return res.status(400).json({ error: "paymentIntentId is required" });
    }

    // Verify ownership via Stripe intent metadata (no Firestore record exists yet)
    const stripe = await paymentService.getStripe();
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (intent.metadata.userId !== req.user.uid) {
      return res.status(403).json({ error: "Not authorized" });
    }

    if (intent.status === "succeeded") {
      const result = await paymentService.handlePaymentSuccess(paymentIntentId);

      // Send payment confirmation email (async, non-blocking)
      emailService
        .sendPaymentConfirmation({
          to: req.user.email,
          paymentId: result?.id || paymentIntentId,
          amount: intent.amount,
          currency: intent.currency,
          speedTier: intent.metadata.speedTier,
          invoiceNumber: result?.invoiceId || null,
        })
        .catch((err) =>
          console.error("⚠️ Payment email failed:", err.message)
        );

      return res.json({
        success: true,
        status: "succeeded",
        invoiceId: result?.invoiceId,
      });
    } else if (
      intent.status === "requires_payment_method" ||
      intent.status === "canceled"
    ) {
      await paymentService.handlePaymentFailure(
        paymentIntentId,
        intent.last_payment_error?.message || "Payment was not completed"
      );
      return res.json({ success: false, status: "failed" });
    } else {
      // Still processing
      return res.json({ success: true, status: intent.status });
    }
  } catch (error) {
    console.error("🚨 Confirm payment error:", error.message);
    res.status(500).json({ error: "Failed to confirm payment" });
  }
});

// POST /api/payments/cancel — Cancel a pending payment intent
router.post("/cancel", verifyToken, async (req, res) => {
  try {
    const { paymentIntentId } = req.body;

    if (!paymentIntentId) {
      return res.status(400).json({ error: "paymentIntentId is required" });
    }

    // Verify ownership via Stripe intent metadata
    const stripe = await paymentService.getStripe();
    let intent;
    try {
      intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    } catch {
      return res.json({ success: true, message: "Payment intent not found or already expired" });
    }

    if (intent.metadata.userId !== req.user.uid) {
      return res.status(403).json({ error: "Not authorized" });
    }

    // Don't cancel succeeded payments
    if (intent.status === "succeeded") {
      return res.status(400).json({ error: "Cannot cancel a completed payment" });
    }

    // Cancel on Stripe
    if (intent.status !== "canceled") {
      await stripe.paymentIntents.cancel(paymentIntentId).catch(() => {});
    }

    // Clear pending intent from certDoc (no Firestore payment record to delete)
    if (intent.metadata.certDocId) {
      const db = admin.firestore();
      await db.collection("certifiedDocuments").doc(intent.metadata.certDocId).update({
        "payment.pendingIntentId": admin.firestore.FieldValue.delete(),
        "payment.pendingSpeedTier": admin.firestore.FieldValue.delete(),
      }).catch(() => {});
    }

    res.json({ success: true, message: "Payment canceled" });
  } catch (error) {
    console.error("🚨 Cancel payment error:", error.message);
    res.status(500).json({ error: "Failed to cancel payment" });
  }
});

// GET /api/payments/intent-status/:intentId — Check payment intent status directly via Stripe
// Used for polling during checkout (no Firestore record exists for pending payments)
router.get("/intent-status/:intentId", verifyToken, async (req, res) => {
  try {
    const stripe = await paymentService.getStripe();
    const intent = await stripe.paymentIntents.retrieve(req.params.intentId);

    if (intent.metadata.userId !== req.user.uid) {
      return res.status(403).json({ error: "Not authorized" });
    }

    if (intent.status === "succeeded") {
      const result = await paymentService.handlePaymentSuccess(intent.id);
      return res.json({
        success: true,
        status: "succeeded",
        invoiceId: result?.invoiceId,
      });
    } else if (intent.status === "canceled" || intent.last_payment_error) {
      return res.json({
        success: true,
        status: "failed",
        failureReason: intent.last_payment_error?.message || "Payment was canceled",
      });
    } else {
      return res.json({ success: true, status: intent.status });
    }
  } catch (error) {
    console.error("🚨 Intent status error:", error.message);
    res.status(500).json({ error: "Failed to check payment status" });
  }
});

// GET /api/payments/status/:paymentId — Check payment status by record ID (for existing records)
router.get("/status/:paymentId", verifyToken, async (req, res) => {
  try {
    const payment = await paymentService.getPaymentById(req.params.paymentId);
    if (!payment) {
      return res.status(404).json({ error: "Payment not found" });
    }
    if (payment.userId !== req.user.uid) {
      return res.status(403).json({ error: "Not authorized" });
    }

    res.json({ success: true, status: payment.status, payment });
  } catch (error) {
    console.error("🚨 Payment status error:", error.message);
    res.status(500).json({ error: "Failed to check payment status" });
  }
});

// GET /api/payments/history — Get user's payment history
router.get("/history", verifyToken, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const allPayments = await paymentService.getUserPayments(req.user.uid, {
      limit,
    });

    // Only return succeeded payments to users — no incomplete/pending/failed
    const payments = allPayments.filter((p) => p.status === "succeeded");

    res.json({ success: true, payments });
  } catch (error) {
    console.error("🚨 Payment history error:", error.message);
    res.status(500).json({ error: "Failed to fetch payment history" });
  }
});

// GET /api/payments/invoices — Get user's invoices
router.get("/invoices", verifyToken, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const invoices = await paymentService.getUserInvoices(req.user.uid, {
      limit,
    });

    res.json({ success: true, invoices });
  } catch (error) {
    console.error("🚨 Invoices error:", error.message);
    res.status(500).json({ error: "Failed to fetch invoices" });
  }
});

// GET /api/payments/invoice/:invoiceId — Get single invoice
router.get("/invoice/:invoiceId", verifyToken, async (req, res) => {
  try {
    const invoice = await paymentService.getInvoice(
      req.params.invoiceId,
      req.user.uid
    );
    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }
    res.json({ success: true, invoice });
  } catch (error) {
    console.error("🚨 Invoice error:", error.message);
    res.status(500).json({ error: "Failed to fetch invoice" });
  }
});

// ============================================
// STRIPE WEBHOOK — Handles async payment events
// Raw body is parsed by middleware in index.js (before express.json())
// ============================================
router.post(
  "/webhook",
  async (req, res) => {
    const sig = req.headers["stripe-signature"];

    // Get webhook secret from Firestore settings or env var
    let endpointSecret;
    try {
      const settings = await paymentService.getPaymentSettings();
      endpointSecret = settings.stripeWebhookSecret || process.env.STRIPE_WEBHOOK_SECRET;
    } catch {
      endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    }

    if (!endpointSecret) {
      // In production, webhook signature verification is MANDATORY
      if (process.env.NODE_ENV === "production") {
        console.error("🚨 STRIPE_WEBHOOK_SECRET is not set in production — rejecting webhook");
        return res.status(500).json({ error: "Webhook secret not configured" });
      }

      console.warn(
        "⚠️ STRIPE_WEBHOOK_SECRET not set — webhook validation skipped (dev mode only)"
      );
      // In dev mode without webhook secret, still process events
      try {
        const event = JSON.parse(req.body.toString());
        await processStripeEvent(event);
        return res.json({ received: true });
      } catch (err) {
        console.error("🚨 Webhook parse error:", err.message);
        return res.status(400).json({ error: "Invalid payload" });
      }
    }

    let event;

    try {
      const stripe = await paymentService.getStripe();
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error("🚨 Webhook signature verification failed:", err.message);
      return res.status(400).json({ error: "Webhook signature failed" });
    }

    await processStripeEvent(event);

    res.json({ received: true });
  }
);

/**
 * Process Stripe webhook events
 */
async function processStripeEvent(event) {
  console.log(`📦 Stripe webhook: ${event.type}`);

  switch (event.type) {
    case "payment_intent.succeeded": {
      const intent = event.data.object;
      const result = await paymentService.handlePaymentSuccess(intent.id);

      // Send confirmation email
      if (intent.receipt_email && result) {
        emailService
          .sendPaymentConfirmation({
            to: intent.receipt_email,
            paymentId: result.id,
            amount: result.amount,
            currency: result.currency,
            speedTier: result.speedTier,
            invoiceNumber: result.invoiceId,
          })
          .catch((err) =>
            console.error("⚠️ Payment email failed:", err.message)
          );
      }
      break;
    }

    case "payment_intent.payment_failed": {
      const intent = event.data.object;
      const failureMessage =
        intent.last_payment_error?.message || "Payment failed";
      await paymentService.handlePaymentFailure(intent.id, failureMessage);
      break;
    }

    case "payment_intent.canceled": {
      const intent = event.data.object;
      await paymentService.handlePaymentFailure(intent.id, "Payment was canceled");
      break;
    }

    default:
      console.log(`ℹ️ Unhandled Stripe event: ${event.type}`);
  }
}

// ============================================
// PUBLIC PAYMENT CONFIG ENDPOINTS
// ============================================

// GET /api/payments/config — Get Stripe publishable key and pricing (for frontend)
router.get("/config", async (req, res) => {
  try {
    const settings = await paymentService.getPaymentSettings();
    const publishableKey =
      settings.stripePublishableKey ||
      process.env.VITE_STRIPE_PUBLISHABLE_KEY ||
      "";
    const pricing = settings.pricing || paymentService.DEFAULT_PRICING;
    const paymentsEnabled = settings.paymentsEnabled !== false && !!publishableKey;

    res.json({
      success: true,
      publishableKey,
      pricing,
      paymentsEnabled,
    });
  } catch (error) {
    console.error("🚨 Payment config error:", error.message);
    res.status(500).json({ error: "Failed to fetch payment config" });
  }
});

// ============================================
// ADMIN PAYMENT ENDPOINTS
// ============================================

// GET /api/payments/admin/all — Get all payments (admin only)
router.get(
  "/admin/all",
  verifyToken,
  requireRole([ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const status = req.query.status || null;
      const payments = await paymentService.getAllPayments({ limit, status });

      res.json({ success: true, payments });
    } catch (error) {
      console.error("🚨 Admin payments error:", error.message);
      res.status(500).json({ error: "Failed to fetch payments" });
    }
  }
);

// GET /api/payments/admin/stats — Get payment statistics (admin only)
router.get(
  "/admin/stats",
  verifyToken,
  requireRole([ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const stats = await paymentService.getPaymentStats();
      res.json({ success: true, stats });
    } catch (error) {
      console.error("🚨 Payment stats error:", error.message);
      res.status(500).json({ error: "Failed to fetch payment stats" });
    }
  }
);

// POST /api/payments/admin/cleanup — Expire stale pending payments (admin only)
router.post(
  "/admin/cleanup",
  verifyToken,
  requireRole([ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const maxAgeHours = Math.min(parseInt(req.query.maxAgeHours) || 1, 72);
      const result = await paymentService.expireStalePayments(maxAgeHours * 60 * 60 * 1000);
      res.json({ success: true, ...result });
    } catch (error) {
      console.error("🚨 Payment cleanup error:", error.message);
      res.status(500).json({ error: "Failed to clean up stale payments" });
    }
  }
);

module.exports = router;

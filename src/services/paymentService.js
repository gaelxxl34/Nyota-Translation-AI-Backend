// Payment Service for NTC
// Handles Stripe payment processing, tracking, and Firestore management

const admin = require("firebase-admin");
const Stripe = require("stripe");
const { cache, TTL, keys } = require("./cache");

const PAYMENTS_COLLECTION = "payments";
const INVOICES_COLLECTION = "invoices";
const SETTINGS_COLLECTION = "system";
const SETTINGS_DOC = "systemSettings";

const getDb = () => admin.firestore();

// Default pricing (in cents for Stripe) — can be overridden via admin settings
const DEFAULT_PRICING = {
  standard: { amount: 3000, currency: "usd", label: "Standard (Up to 24 hrs)" },
  rush: { amount: 3500, currency: "usd", label: "Rush (Up to 12 hrs)" },
  express: { amount: 4500, currency: "usd", label: "Express (1–5 hrs)" },
};

// Cache the Stripe instance so we don't re-create on every call
let _stripeInstance = null;
let _lastStripeKey = null;

/**
 * Get the Stripe instance — uses key from Firestore settings if available,
 * falls back to env var. Caches the instance and refreshes if key changes.
 */
const getStripe = async () => {
  const settings = await getPaymentSettings();
  const key = settings.stripeSecretKey || process.env.STRIPE_SECRET_KEY;

  if (!key) {
    throw new Error("Stripe secret key is not configured. Set it in Admin → Settings → Payment or in the STRIPE_SECRET_KEY environment variable.");
  }

  if (_stripeInstance && _lastStripeKey === key) {
    return _stripeInstance;
  }

  _stripeInstance = new Stripe(key);
  _lastStripeKey = key;
  return _stripeInstance;
};

/**
 * Get payment settings from Firestore (with caching)
 * Returns: { stripeSecretKey, stripePublishableKey, stripeWebhookSecret, pricing, paymentsEnabled }
 */
const getPaymentSettings = async () => {
  const cacheKey = "paymentSettings:global";
  return cache.getOrSet(cacheKey, 60, async () => {
    try {
      const doc = await getDb()
        .collection(SETTINGS_COLLECTION)
        .doc(SETTINGS_DOC)
        .get();

      if (!doc.exists) return { pricing: DEFAULT_PRICING };

      const data = doc.data();
      return {
        stripeSecretKey: data.stripeSecretKey || null,
        stripePublishableKey: data.stripePublishableKey || null,
        stripeWebhookSecret: data.stripeWebhookSecret || null,
        paymentsEnabled: data.paymentsEnabled !== false,
        pricing: data.pricing || DEFAULT_PRICING,
      };
    } catch (err) {
      console.warn("⚠️ Could not read payment settings from Firestore:", err.message);
      return { pricing: DEFAULT_PRICING };
    }
  });
};

/**
 * Get effective pricing — from Firestore settings or defaults
 */
const getPricing = async () => {
  const settings = await getPaymentSettings();
  return settings.pricing || DEFAULT_PRICING;
};

// Keep a synchronous getter for backward compatibility in invoice labels
const PRICING = DEFAULT_PRICING;

/**
 * Create a Stripe Payment Intent for a document submission
 * NO Firestore record is created here — records are only created on success or failure.
 * Pending intent reference is stored on the certifiedDocument for dedup/tracking.
 */
const createPaymentIntent = async ({
  userId,
  userEmail,
  certDocId,
  speedTier,
  formType,
  documentTitle,
}) => {
  const pricing = await getPricing();
  const tierPricing = pricing[speedTier];
  if (!tierPricing) {
    throw new Error(`Invalid speed tier: ${speedTier}`);
  }

  const stripe = await getStripe();
  const db = getDb();

  // Check if there's already a pending intent on the certified document
  const certDocRef = db.collection("certifiedDocuments").doc(certDocId);
  const certDocSnap = await certDocRef.get();

  if (certDocSnap.exists) {
    const pendingIntentId = certDocSnap.data()?.payment?.pendingIntentId;

    if (pendingIntentId) {
      try {
        const existingIntent = await stripe.paymentIntents.retrieve(pendingIntentId);

        if (
          existingIntent.status === "requires_payment_method" ||
          existingIntent.status === "requires_confirmation" ||
          existingIntent.status === "requires_action"
        ) {
          // Same tier → reuse the existing intent
          if (certDocSnap.data()?.payment?.pendingSpeedTier === speedTier) {
            return {
              stripePaymentIntentId: existingIntent.id,
              clientSecret: existingIntent.client_secret,
              amount: tierPricing.amount,
              currency: tierPricing.currency,
            };
          }
          // Different tier → cancel old intent and create a new one
          await stripe.paymentIntents.cancel(pendingIntentId).catch(() => {});
        } else if (existingIntent.status === "succeeded") {
          // Intent actually succeeded — reconcile
          await handlePaymentSuccess(pendingIntentId);
          throw new Error("Document has already been paid for");
        }
        // For canceled/other statuses → proceed to create new
      } catch (e) {
        if (e.message === "Document has already been paid for") throw e;
        console.warn("⚠️ Existing pending intent invalid:", e.message);
      }
    }
  }

  // Create Stripe Payment Intent — all metadata stored on the intent itself
  const paymentIntent = await stripe.paymentIntents.create({
    amount: tierPricing.amount,
    currency: tierPricing.currency,
    metadata: {
      userId,
      userEmail,
      certDocId,
      speedTier,
      formType: formType || "unknown",
      documentTitle: (documentTitle || "").slice(0, 450), // Stripe metadata 500 char limit
    },
    description: `NTC - ${tierPricing.label} translation: ${documentTitle || certDocId}`,
    receipt_email: userEmail,
  });

  // Store pending intent reference on the certified document (lightweight tracking only)
  await certDocRef.update({
    "payment.pendingIntentId": paymentIntent.id,
    "payment.pendingSpeedTier": speedTier,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }).catch((err) => {
    console.warn("⚠️ Could not update certDoc with pending intent:", err.message);
  });

  return {
    stripePaymentIntentId: paymentIntent.id,
    clientSecret: paymentIntent.client_secret,
    amount: tierPricing.amount,
    currency: tierPricing.currency,
  };
};

/**
 * Record payment success — called from webhook or manual confirmation.
 * CREATES the payment record in Firestore (no pending record exists).
 * Uses Stripe intent ID as Firestore doc ID for natural dedup.
 */
const handlePaymentSuccess = async (stripePaymentIntentId) => {
  const db = getDb();

  // Idempotency: check if already recorded (using intent ID as doc key)
  const existingRef = db.collection(PAYMENTS_COLLECTION).doc(stripePaymentIntentId);
  const existingSnap = await existingRef.get();

  if (existingSnap.exists && existingSnap.data().status === "succeeded") {
    console.log(`✅ Payment already recorded for intent: ${stripePaymentIntentId}`);
    return existingSnap.data();
  }

  // Verify with Stripe and get full metadata
  const stripe = await getStripe();
  const intent = await stripe.paymentIntents.retrieve(stripePaymentIntentId);

  if (intent.status !== "succeeded") {
    console.warn(`⚠️ Payment intent ${stripePaymentIntentId} status is ${intent.status}, not succeeded — skipping`);
    return null;
  }

  const { userId, userEmail, certDocId, speedTier, formType, documentTitle } = intent.metadata;

  if (!userId || !certDocId) {
    console.error(`🚨 Missing metadata on intent ${stripePaymentIntentId}`);
    return null;
  }

  // Amount reconciliation
  const pricing = await getPricing();
  const expectedAmount = pricing[speedTier]?.amount;
  if (expectedAmount && intent.amount_received !== expectedAmount) {
    console.warn(`⚠️ Amount mismatch: expected ${expectedAmount}, received ${intent.amount_received}`);
  }

  const paymentId = `pay_${userId}_${Date.now()}`;
  const batch = db.batch();

  // 1. Create payment record
  const paymentDoc = {
    id: paymentId,
    userId,
    userEmail: userEmail || intent.receipt_email,
    certDocId,
    stripePaymentIntentId,
    amount: intent.amount_received || intent.amount,
    currency: intent.currency,
    speedTier,
    formType: formType || "unknown",
    documentTitle: documentTitle || null,
    status: "succeeded",
    stripeStatus: "succeeded",
    failureReason: null,
    refundId: null,
    refundAmount: null,
    invoiceId: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  batch.set(existingRef, paymentDoc);

  // 2. Update the certified document — mark paid and clear pending intent
  const certDocRef = db.collection("certifiedDocuments").doc(certDocId);
  batch.update(certDocRef, {
    "payment.paymentId": paymentId,
    "payment.stripePaymentIntentId": stripePaymentIntentId,
    "payment.amount": paymentDoc.amount,
    "payment.currency": paymentDoc.currency,
    "payment.status": "paid",
    "payment.paidAt": admin.firestore.FieldValue.serverTimestamp(),
    "payment.pendingIntentId": admin.firestore.FieldValue.delete(),
    "payment.pendingSpeedTier": admin.firestore.FieldValue.delete(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // 3. Create invoice
  const invoiceId = `inv_${userId}_${Date.now()}`;
  const invoiceDoc = {
    id: invoiceId,
    paymentId,
    userId,
    userEmail: userEmail || intent.receipt_email,
    certDocId,
    stripePaymentIntentId,
    amount: paymentDoc.amount,
    currency: paymentDoc.currency,
    speedTier,
    formType: formType || "unknown",
    documentTitle: documentTitle || null,
    status: "paid",
    invoiceNumber: `NTC-${Date.now().toString(36).toUpperCase()}`,
    issuedAt: admin.firestore.FieldValue.serverTimestamp(),
    paidAt: admin.firestore.FieldValue.serverTimestamp(),
    items: [
      {
        description: `Certified Translation - ${PRICING[speedTier]?.label || speedTier}`,
        amount: paymentDoc.amount,
        quantity: 1,
      },
    ],
  };

  batch.set(db.collection(INVOICES_COLLECTION).doc(invoiceId), invoiceDoc);

  // 4. Update payment with invoice reference
  batch.update(existingRef, { invoiceId });

  await batch.commit();

  // Invalidate caches
  await cache.invalidatePrefix(`payments:${userId}`);
  await cache.invalidatePrefix(`invoices:${userId}`);

  console.log(`✅ Payment recorded: ${paymentId} | Invoice: ${invoiceId}`);

  return { ...paymentDoc, invoiceId };
};

/**
 * Record payment failure — CREATES a failed record from Stripe intent metadata.
 * No pending record exists, so we create one on failure (for audit trail).
 */
const handlePaymentFailure = async (
  stripePaymentIntentId,
  failureReason
) => {
  const db = getDb();

  // Idempotency: check if already recorded (using intent ID as doc key)
  const existingRef = db.collection(PAYMENTS_COLLECTION).doc(stripePaymentIntentId);
  const existingSnap = await existingRef.get();

  if (existingSnap.exists) {
    const existing = existingSnap.data();
    if (existing.status === "failed" || existing.status === "succeeded") {
      return existing;
    }
  }

  // Get intent metadata from Stripe
  let metadata = {};
  let intentAmount = 0;
  try {
    const stripe = await getStripe();
    const intent = await stripe.paymentIntents.retrieve(stripePaymentIntentId);
    metadata = intent.metadata || {};
    intentAmount = intent.amount || 0;
  } catch (err) {
    console.warn(`⚠️ Could not retrieve intent ${stripePaymentIntentId}: ${err.message}`);
  }

  const { userId, userEmail, certDocId, speedTier, formType, documentTitle } = metadata;
  const paymentId = `pay_${userId || "unknown"}_${Date.now()}`;

  const paymentDoc = {
    id: paymentId,
    userId: userId || null,
    userEmail: userEmail || null,
    certDocId: certDocId || null,
    stripePaymentIntentId,
    amount: intentAmount,
    currency: "usd",
    speedTier: speedTier || null,
    formType: formType || "unknown",
    documentTitle: documentTitle || null,
    status: "failed",
    stripeStatus: "failed",
    failureReason: failureReason || "Payment was declined",
    refundId: null,
    refundAmount: null,
    invoiceId: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    completedAt: null,
  };

  await existingRef.set(paymentDoc);

  // Clear pending intent from certDoc
  if (certDocId) {
    try {
      await db.collection("certifiedDocuments").doc(certDocId).update({
        "payment.pendingIntentId": admin.firestore.FieldValue.delete(),
        "payment.pendingSpeedTier": admin.firestore.FieldValue.delete(),
      });
    } catch (err) {
      console.warn(`⚠️ Could not clear pendingIntentId from certDoc: ${err.message}`);
    }
    if (userId) await cache.invalidatePrefix(`payments:${userId}`);
  }

  console.log(`❌ Payment failed: ${paymentId} — ${failureReason}`);
  return paymentDoc;
};

/**
 * Get payment by Stripe Payment Intent ID
 */
const getPaymentByIntentId = async (stripePaymentIntentId) => {
  const snap = await getDb()
    .collection(PAYMENTS_COLLECTION)
    .where("stripePaymentIntentId", "==", stripePaymentIntentId)
    .limit(1)
    .get();

  if (snap.empty) return null;
  return snap.docs[0].data();
};

/**
 * Get payment by ID
 */
const getPaymentById = async (paymentId) => {
  const snap = await getDb()
    .collection(PAYMENTS_COLLECTION)
    .doc(paymentId)
    .get();

  if (!snap.exists) return null;
  return snap.data();
};

/**
 * Get user's payment history with pagination
 */
const getUserPayments = async (userId, { limit = 20, startAfterDate = null } = {}) => {
  let q = getDb()
    .collection(PAYMENTS_COLLECTION)
    .where("userId", "==", userId)
    .orderBy("createdAt", "desc")
    .limit(limit);

  if (startAfterDate) {
    q = q.startAfter(startAfterDate);
  }

  const snap = await q.get();
  return snap.docs.map((doc) => {
    const data = doc.data();
    return {
      ...data,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      updatedAt: data.updatedAt?.toDate?.()?.toISOString() || null,
      completedAt: data.completedAt?.toDate?.()?.toISOString() || null,
    };
  });
};

/**
 * Get user's invoices
 */
const getUserInvoices = async (userId, { limit = 20 } = {}) => {
  const snap = await getDb()
    .collection(INVOICES_COLLECTION)
    .where("userId", "==", userId)
    .orderBy("issuedAt", "desc")
    .limit(limit)
    .get();

  return snap.docs.map((doc) => {
    const data = doc.data();
    return {
      ...data,
      issuedAt: data.issuedAt?.toDate?.()?.toISOString() || null,
      paidAt: data.paidAt?.toDate?.()?.toISOString() || null,
    };
  });
};

/**
 * Get a single invoice by ID (with ownership check)
 */
const getInvoice = async (invoiceId, userId) => {
  const snap = await getDb()
    .collection(INVOICES_COLLECTION)
    .doc(invoiceId)
    .get();

  if (!snap.exists) return null;

  const data = snap.data();
  if (data.userId !== userId) return null; // ownership check

  return {
    ...data,
    issuedAt: data.issuedAt?.toDate?.()?.toISOString() || null,
    paidAt: data.paidAt?.toDate?.()?.toISOString() || null,
  };
};

/**
 * Get payment by certDocId (to check if document was already paid for)
 */
const getPaymentForDocument = async (certDocId) => {
  const snap = await getDb()
    .collection(PAYMENTS_COLLECTION)
    .where("certDocId", "==", certDocId)
    .where("status", "==", "succeeded")
    .limit(1)
    .get();

  if (snap.empty) return null;
  return snap.docs[0].data();
};

/**
 * Get all payments for admin dashboard
 */
const getAllPayments = async ({ limit = 50, status = null } = {}) => {
  let q = getDb()
    .collection(PAYMENTS_COLLECTION)
    .orderBy("createdAt", "desc")
    .limit(limit);

  if (status) {
    q = q.where("status", "==", status);
  }

  const snap = await q.get();
  return snap.docs.map((doc) => {
    const data = doc.data();
    return {
      ...data,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      updatedAt: data.updatedAt?.toDate?.()?.toISOString() || null,
      completedAt: data.completedAt?.toDate?.()?.toISOString() || null,
    };
  });
};

/**
 * Get payment stats (for admin dashboard)
 */
const getPaymentStats = async () => {
  const cacheKey = "paymentStats:global";
  return cache.getOrSet(cacheKey, TTL.STATS, async () => {
    const db = getDb();
    const snap = await db
      .collection(PAYMENTS_COLLECTION)
      .where("status", "==", "succeeded")
      .get();

    let totalRevenue = 0;
    const byTier = { standard: 0, rush: 0, express: 0 };
    const byMonth = {};

    snap.forEach((doc) => {
      const data = doc.data();
      totalRevenue += data.amount || 0;
      if (data.speedTier && byTier[data.speedTier] !== undefined) {
        byTier[data.speedTier] += data.amount || 0;
      }
      
      const date = data.completedAt?.toDate?.() || data.createdAt?.toDate?.();
      if (date) {
        const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        byMonth[month] = (byMonth[month] || 0) + (data.amount || 0);
      }
    });

    return {
      totalRevenue,
      totalTransactions: snap.size,
      byTier,
      byMonth,
    };
  });
};

/**
 * Cancel pending Stripe intent for a given document.
 * Now checks the certifiedDocument's pendingIntentId instead of payments collection.
 */
const cancelStalePendingIntents = async (certDocId, stripeInstance = null) => {
  const db = getDb();
  const stripe = stripeInstance || await getStripe();

  const certDocRef = db.collection("certifiedDocuments").doc(certDocId);
  const certDocSnap = await certDocRef.get();
  if (!certDocSnap.exists) return 0;

  const pendingIntentId = certDocSnap.data()?.payment?.pendingIntentId;
  if (!pendingIntentId) return 0;

  try {
    const intent = await stripe.paymentIntents.retrieve(pendingIntentId);
    if (intent.status !== "canceled" && intent.status !== "succeeded") {
      await stripe.paymentIntents.cancel(pendingIntentId);
    }
  } catch (err) {
    console.warn(`⚠️ Could not cancel Stripe intent ${pendingIntentId}: ${err.message}`);
  }

  await certDocRef.update({
    "payment.pendingIntentId": admin.firestore.FieldValue.delete(),
    "payment.pendingSpeedTier": admin.firestore.FieldValue.delete(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return 1;
};

/**
 * Expire stale pending intents on certified documents.
 * Checks certifiedDocuments with a pendingIntentId and cancels intents older than the cutoff.
 */
const expireStalePayments = async (maxAgeMs = 60 * 60 * 1000) => {
  const db = getDb();
  const cutoff = new Date(Date.now() - maxAgeMs);

  // Find certDocs with pending intents that were updated before the cutoff
  const staleSnap = await db
    .collection("certifiedDocuments")
    .where("payment.pendingIntentId", "!=", null)
    .where("updatedAt", "<", cutoff)
    .limit(100)
    .get();

  if (staleSnap.empty) return { expired: 0 };

  let stripe;
  try {
    stripe = await getStripe();
  } catch {
    console.warn("⚠️ Cannot expire stale payments — Stripe not configured");
    return { expired: 0 };
  }

  let expired = 0;
  for (const doc of staleSnap.docs) {
    const data = doc.data();
    const pendingIntentId = data.payment?.pendingIntentId;
    if (!pendingIntentId) continue;

    try {
      const intent = await stripe.paymentIntents.retrieve(pendingIntentId);
      if (intent.status === "succeeded") {
        // Payment actually succeeded — reconcile
        await handlePaymentSuccess(pendingIntentId);
        console.log(`🔄 Reconciled stale intent ${pendingIntentId} — was actually succeeded on Stripe`);
        continue;
      }
      if (intent.status !== "canceled") {
        await stripe.paymentIntents.cancel(pendingIntentId);
      }
    } catch (err) {
      console.warn(`⚠️ Could not process stale intent ${pendingIntentId}: ${err.message}`);
    }

    await doc.ref.update({
      "payment.pendingIntentId": admin.firestore.FieldValue.delete(),
      "payment.pendingSpeedTier": admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    expired++;
  }

  console.log(`🧹 Expired ${expired} stale pending intent(s)`);
  return { expired };
};

module.exports = {
  PRICING,
  DEFAULT_PRICING,
  getStripe,
  getPaymentSettings,
  getPricing,
  createPaymentIntent,
  handlePaymentSuccess,
  handlePaymentFailure,
  getPaymentById,
  getUserPayments,
  getUserInvoices,
  getInvoice,
  getPaymentForDocument,
  getAllPayments,
  getPaymentStats,
  cancelStalePendingIntents,
  expireStalePayments,
};

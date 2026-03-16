// Notification Service for NTC
// Orchestrates email + Firestore notifications for document lifecycle events

const admin = require("firebase-admin");
const {
  sendSubmissionConfirmation,
  sendResubmissionConfirmation,
  sendCertificationComplete,
  sendRejectionNotice,
  sendNewDocumentAlert,
  sendDocumentClaimedNotice,
  sendTicketCreatedConfirmation,
  sendNewTicketAlert,
  sendTicketResolvedNotice,
} = require("./emailService");
const { cache, TTL, keys } = require("./cache");

const NOTIFICATIONS_COLLECTION = "notifications";

const getDb = () => admin.firestore();

/**
 * Create a Firestore notification record
 */
const createNotification = async ({ recipientId, type, title, message, metadata }) => {
  const db = getDb();
  const ref = db.collection(NOTIFICATIONS_COLLECTION).doc();

  await ref.set({
    id: ref.id,
    recipientId,
    type,
    title,
    message,
    metadata: metadata || {},
    read: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return ref.id;
};

/**
 * Get user info from Firestore (cached)
 */
const getUserInfo = async (userId) => {
  return cache.getOrSet(keys.user(userId), TTL.USER, async () => {
    const snap = await getDb().collection("users").doc(userId).get();
    if (!snap.exists) return null;
    const data = snap.data();
    return { email: data.email, displayName: data.displayName || data.email };
  });
};

/**
 * Get active translators who have email alerts enabled (cached)
 */
const getActiveTranslators = async () => {
  return cache.getOrSet(keys.activeTranslators(), TTL.QUEUE, async () => {
    const snap = await getDb()
      .collection("users")
      .where("role", "in", ["translator", "superadmin"])
      .where("isActive", "==", true)
      .get();

    return snap.docs.map((doc) => doc.data()).filter(Boolean);
  });
};

// ============================================
// LIFECYCLE EVENT HANDLERS
// ============================================

/**
 * Notify: Document submitted for review (draft → pending_review)
 * - Email to user (confirmation)
 * - Email to translators (new item alert)
 * - Firestore notification for translators
 */
const onDocumentSubmitted = async (doc) => {
  const { userId, id: docId, formType, speedTier, sourceLanguage } = doc;

  // 1. Notify the user
  const user = await getUserInfo(userId);
  if (user?.email) {
    await sendSubmissionConfirmation(user.email, user.displayName, {
      docId,
      formType,
      speedTier,
    }).catch((err) => console.error("🚨 Submission email failed:", err.message));
  }

  // 2. Notify translators
  const translators = await getActiveTranslators();
  for (const translator of translators) {
    // Firestore notification
    await createNotification({
      recipientId: translator.uid,
      type: "new_document",
      title: "New document for review",
      message: `A ${formType || "document"} (${speedTier?.label || "Standard"}) is waiting for review.`,
      metadata: { docId, formType, speedTier: speedTier?.id, sourceLanguage },
    }).catch((err) => console.error("🚨 Notification create failed:", err.message));

    // Email alert (only if they have alerts enabled)
    if (translator.preferences?.emailAlerts !== false && translator.email) {
      await sendNewDocumentAlert(translator.email, translator.displayName, {
        docId,
        formType,
        speedTier,
        sourceLanguage,
      }).catch((err) => console.error("🚨 Translator alert email failed:", err.message));
    }
  }
};

/**
 * Notify: Document re-submitted after rejection
 * - Firestore notification for user (confirmation)
 * - Email to user (re-submission confirmation)
 */
const onDocumentResubmitted = async (doc) => {
  const { userId, id: docId, formType } = doc;

  const user = await getUserInfo(userId);

  // Firestore notification
  await createNotification({
    recipientId: userId,
    type: "document_resubmitted",
    title: "Document re-submitted",
    message: `Your ${formType || "document"} has been re-submitted for review after the previous rejection.`,
    metadata: { docId, formType },
  }).catch((err) => console.error("🚨 Resubmission notification failed:", err.message));

  // Email
  if (user?.email) {
    await sendResubmissionConfirmation(user.email, user.displayName, {
      docId,
      formType,
    }).catch((err) => console.error("🚨 Resubmission email failed:", err.message));
  }
};

/**
 * Notify: Document certified (in_review → certified)
 * - Email to user with certification ID
 * - Firestore notification for user
 */
const onDocumentCertified = async (doc, certificationId) => {
  const { userId, id: docId, formType } = doc;

  const user = await getUserInfo(userId);

  // Firestore notification
  await createNotification({
    recipientId: userId,
    type: "document_certified",
    title: "Document certified!",
    message: `Your ${formType || "document"} has been certified. ID: ${certificationId}`,
    metadata: { docId, certificationId, formType },
  }).catch((err) => console.error("🚨 Certification notification failed:", err.message));

  // Email
  if (user?.email) {
    await sendCertificationComplete(user.email, user.displayName, {
      docId,
      certificationId,
      formType,
    }).catch((err) => console.error("🚨 Certification email failed:", err.message));
  }
};

/**
 * Notify: Document rejected (in_review → rejected)
 * - Email to user with reason
 * - Firestore notification for user
 */
const onDocumentRejected = async (doc, reason, rejectionType) => {
  const { userId, id: docId, formType } = doc;

  const user = await getUserInfo(userId);

  // Firestore notification
  await createNotification({
    recipientId: userId,
    type: "document_rejected",
    title: "Document needs attention",
    message: reason,
    metadata: { docId, formType, rejectionType },
  }).catch((err) => console.error("🚨 Rejection notification failed:", err.message));

  // Email
  if (user?.email) {
    await sendRejectionNotice(user.email, user.displayName, {
      docId,
      reason,
      rejectionType,
    }).catch((err) => console.error("🚨 Rejection email failed:", err.message));
  }
};

/**
 * Notify: Document claimed by translator
 * - Firestore notification for user (informational)
 */
const onDocumentClaimed = async (doc, translatorId) => {
  const { userId, id: docId, formType } = doc;

  // Firestore notification
  await createNotification({
    recipientId: userId,
    type: "document_in_review",
    title: "Document under review",
    message: `Your ${formType || "document"} is now being reviewed by a translator.`,
    metadata: { docId, formType },
  }).catch((err) => console.error("🚨 Claim notification failed:", err.message));

  // Email notification
  const user = await getUserInfo(userId);
  if (user?.email) {
    await sendDocumentClaimedNotice(user.email, user.displayName, {
      docId,
      formType,
    }).catch((err) => console.error("🚨 Claim email failed:", err.message));
  }
};

// ============================================
// SUPPORT TICKET LIFECYCLE HANDLERS
// ============================================

/**
 * Get active support agents who have email alerts enabled (cached)
 */
const getActiveSupportAgents = async () => {
  return cache.getOrSet(keys.activeSupportAgents(), TTL.QUEUE, async () => {
    const snap = await getDb()
      .collection("users")
      .where("role", "in", ["support", "superadmin"])
      .where("isActive", "==", true)
      .get();

    return snap.docs.map((doc) => doc.data()).filter(Boolean);
  });
};

/**
 * Notify: Support ticket created
 * - Email confirmation to user
 * - Firestore notifications to support agents
 * - Email alerts to support agents
 */
const onTicketCreated = async (ticket) => {
  const { id: ticketId, userId, userEmail, userName, subject, category, priority } = ticket;

  // 1. Confirm to user
  if (userEmail) {
    await sendTicketCreatedConfirmation(userEmail, userName, {
      ticketId,
      subject,
      category,
    }).catch((err) => console.error("🚨 Ticket confirmation email failed:", err.message));
  }

  // 2. Notify support agents
  const agents = await getActiveSupportAgents();
  for (const agent of agents) {
    // Firestore notification
    await createNotification({
      recipientId: agent.uid,
      type: "new_ticket",
      title: "New support ticket",
      message: `${userName || "A user"} submitted: "${subject}"`,
      metadata: { ticketId, category, priority, userId },
    }).catch((err) => console.error("🚨 Ticket notification create failed:", err.message));

    // Email alert
    if (agent.preferences?.emailAlerts !== false && agent.email) {
      await sendNewTicketAlert(agent.email, agent.displayName, {
        ticketId,
        subject,
        category,
        priority,
        userName,
        userEmail,
      }).catch((err) => console.error("🚨 Ticket agent alert email failed:", err.message));
    }
  }
};

/**
 * Notify: Support ticket resolved
 * - Email notification to user
 * - Firestore notification for user
 */
const onTicketResolved = async (ticket) => {
  const { id: ticketId, userId, subject } = ticket;

  const user = await getUserInfo(userId);

  // Firestore notification
  await createNotification({
    recipientId: userId,
    type: "ticket_resolved",
    title: "Support ticket resolved",
    message: `Your ticket "${subject}" has been resolved. Please rate our service!`,
    metadata: { ticketId },
  }).catch((err) => console.error("🚨 Ticket resolved notification failed:", err.message));

  // Email
  if (user?.email) {
    await sendTicketResolvedNotice(user.email, user.displayName, {
      ticketId,
      subject,
    }).catch((err) => console.error("🚨 Ticket resolved email failed:", err.message));
  }
};

module.exports = {
  createNotification,
  onDocumentSubmitted,
  onDocumentResubmitted,
  onDocumentCertified,
  onDocumentRejected,
  onDocumentClaimed,
  onTicketCreated,
  onTicketResolved,
};

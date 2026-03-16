// Certified Documents Service for NTC
// Handles CRUD operations for the certifiedDocuments Firestore collection

const admin = require("firebase-admin");
const {
  DOCUMENT_STATUS,
  SPEED_TIERS,
  isValidTransition,
  isTerminalStatus,
  generateCertificationId,
  generateDocumentHash,
} = require("../constants");

const { cache, TTL, keys } = require("./cache");

const COLLECTION = "certifiedDocuments";

const getDb = () => admin.firestore();

/**
 * Clean data for Firestore storage
 * Handles undefined values, nested arrays, and deep nesting limits
 */
const cleanDataForFirestore = (data, depth = 0, insideArray = false) => {
  if (data === null || data === undefined) return null;
  if (typeof data !== "object") return data;
  if (depth > 15) return JSON.stringify(data);

  if (Array.isArray(data)) {
    if (insideArray) {
      const obj = {};
      data.forEach((item, i) => {
        obj[String(i)] = cleanDataForFirestore(item, depth + 1, false);
      });
      return obj;
    }
    return data.map((item) => cleanDataForFirestore(item, depth + 1, true));
  }

  const cleaned = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      cleaned[key] = cleanDataForFirestore(value, depth + 1, false);
    }
  }
  return cleaned;
};

/**
 * Create a new submission (status: draft)
 * Called after AI extraction completes — stores AI result + original file refs
 */
const createSubmission = async ({
  userId,
  userEmail,
  formType,
  sourceLanguage,
  targetLanguage,
  originalData,
  storageUrl,
  storagePath,
  storageBucket,
  fileName,
  fileSize,
  bulletinId,
}) => {
  const db = getDb();
  const docId = `cert_${userId}_${Date.now()}`;

  // Clean originalData to avoid Firestore nested entity errors
  const cleanedOriginalData = cleanDataForFirestore(originalData);

  const doc = {
    id: docId,
    userId,
    userEmail,
    formType,
    sourceLanguage: sourceLanguage || "auto",
    targetLanguage: targetLanguage || "en",
    status: DOCUMENT_STATUS.DRAFT,
    bulletinId: bulletinId || null,
    originalData: cleanedOriginalData,
    editedData: null,
    certifiedData: null,
    certification: null,
    speedTier: null,
    metadata: {
      fileName,
      fileSize,
      storageUrl: storageUrl || null,
      storagePath: storagePath || null,
      storageBucket: storageBucket || null,
      uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastModified: admin.firestore.FieldValue.serverTimestamp(),
    },
    assignment: {
      assignedTo: null,
      assignedAt: null,
      claimedAt: null,
    },
    review: {
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: null,
      rejectionType: null,
    },
    payment: null,
    isActive: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection(COLLECTION).doc(docId).set(doc);

  // Invalidate user document list cache
  await cache.invalidatePrefix(`userCertDocs:${userId}`);
  return { id: docId, status: DOCUMENT_STATUS.DRAFT };
};

/**
 * Submit for certification (draft → pending_review)
 * User pays and selects speed tier — payment MUST be verified before submission
 */
const submitForReview = async (docId, userId, speedTierId) => {
  const ref = getDb().collection(COLLECTION).doc(docId);
  const snap = await ref.get();

  if (!snap.exists) throw new Error("Document not found");
  const data = snap.data();

  if (data.userId !== userId) throw new Error("Not authorized");
  if (!isValidTransition(data.status, DOCUMENT_STATUS.PENDING_REVIEW)) {
    throw new Error(`Cannot transition from ${data.status} to pending_review`);
  }

  const tier = Object.values(SPEED_TIERS).find((t) => t.id === speedTierId);
  if (!tier) throw new Error("Invalid speed tier");

  // CRITICAL: Verify payment has been completed before allowing submission
  if (data.payment?.status !== "paid") {
    throw new Error("Payment is required before submission. No completed payment found for this document.");
  }

  await ref.update({
    status: DOCUMENT_STATUS.PENDING_REVIEW,
    speedTier: tier,
    "metadata.submittedAt": admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Invalidate caches
  await cache.del(keys.certDoc(docId));
  await cache.invalidatePrefix(`userCertDocs:${userId}`);
  await cache.invalidatePrefix('queue:');

  return { id: docId, status: DOCUMENT_STATUS.PENDING_REVIEW, speedTier: tier };
};

/**
 * Claim a document for review (pending_review → in_review)
 */
const claimForReview = async (docId, translatorId) => {
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(docId);
  const snap = await ref.get();

  if (!snap.exists) throw new Error("Document not found");
  const data = snap.data();

  if (!isValidTransition(data.status, DOCUMENT_STATUS.IN_REVIEW)) {
    throw new Error(`Cannot transition from ${data.status} to in_review`);
  }

  await ref.update({
    status: DOCUMENT_STATUS.IN_REVIEW,
    "assignment.assignedTo": translatorId,
    "assignment.claimedAt": admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await cache.del(keys.certDoc(docId));
  await cache.invalidatePrefix('queue:');

  return { id: docId, status: DOCUMENT_STATUS.IN_REVIEW };
};

/**
 * Release a claimed document back to the queue
 */
const releaseDocument = async (docId, translatorId) => {
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(docId);
  const snap = await ref.get();

  if (!snap.exists) throw new Error("Document not found");
  const data = snap.data();

  if (data.status !== DOCUMENT_STATUS.IN_REVIEW) {
    throw new Error("Document is not in review");
  }
  if (data.assignment.assignedTo !== translatorId) {
    throw new Error("Not assigned to you");
  }

  await ref.update({
    status: DOCUMENT_STATUS.PENDING_REVIEW,
    "assignment.assignedTo": null,
    "assignment.claimedAt": null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await cache.del(keys.certDoc(docId));
  await cache.invalidatePrefix('queue:');

  return { id: docId, status: DOCUMENT_STATUS.PENDING_REVIEW };
};

/**
 * Save translator edits (while in_review)
 */
const updateEditedData = async (docId, translatorId, editedData) => {
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(docId);
  const snap = await ref.get();

  if (!snap.exists) throw new Error("Document not found");
  const data = snap.data();

  if (data.status !== DOCUMENT_STATUS.IN_REVIEW) {
    throw new Error("Document is not in review");
  }
  if (data.assignment.assignedTo !== translatorId) {
    throw new Error("Not assigned to you");
  }

  await ref.update({
    editedData,
    "metadata.lastModified": admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Save revision in subcollection
  await ref.collection("revisions").add({
    editedBy: translatorId,
    data: editedData,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });

  await cache.del(keys.certDoc(docId));

  return { id: docId, updated: true };
};

/**
 * Certify a document (in_review → certified)
 * Freezes data, generates certification ID, stores PDF hash
 */
const certifyDocument = async (docId, translatorId, pdfBuffer) => {
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(docId);
  const snap = await ref.get();

  if (!snap.exists) throw new Error("Document not found");
  const data = snap.data();

  if (data.status !== DOCUMENT_STATUS.IN_REVIEW) {
    throw new Error("Document must be in review to certify");
  }
  if (data.assignment.assignedTo !== translatorId) {
    throw new Error("Not assigned to you");
  }

  const certificationId = generateCertificationId();
  const documentHash = generateDocumentHash(pdfBuffer);
  const certifiedData = data.editedData || data.originalData;

  await ref.update({
    status: DOCUMENT_STATUS.CERTIFIED,
    certifiedData,
    certification: {
      certificationId,
      documentHash,
      certifiedBy: translatorId,
      certifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      pdfSize: pdfBuffer.length,
    },
    "review.reviewedBy": translatorId,
    "review.reviewedAt": admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await cache.del(keys.certDoc(docId));
  await cache.invalidatePrefix('queue:');
  await cache.invalidatePrefix(`userCertDocs:${data.userId}`);

  return {
    id: docId,
    status: DOCUMENT_STATUS.CERTIFIED,
    certificationId,
    documentHash,
  };
};

/**
 * Reject a document (in_review → rejected)
 */
const rejectDocument = async (docId, translatorId, reason, rejectionType) => {
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(docId);
  const snap = await ref.get();

  if (!snap.exists) throw new Error("Document not found");
  const data = snap.data();

  if (data.status !== DOCUMENT_STATUS.IN_REVIEW) {
    throw new Error("Document must be in review to reject");
  }
  if (data.assignment.assignedTo !== translatorId) {
    throw new Error("Not assigned to you");
  }

  await ref.update({
    status: DOCUMENT_STATUS.REJECTED,
    "review.reviewedBy": translatorId,
    "review.reviewedAt": admin.firestore.FieldValue.serverTimestamp(),
    "review.rejectionReason": reason,
    "review.rejectionType": rejectionType || "quality",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await cache.del(keys.certDoc(docId));
  await cache.invalidatePrefix('queue:');
  await cache.invalidatePrefix(`userCertDocs:${data.userId}`);

  return { id: docId, status: DOCUMENT_STATUS.REJECTED };
};

/**
 * Cancel a document (user-initiated)
 */
const cancelDocument = async (docId, userId) => {
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(docId);
  const snap = await ref.get();

  if (!snap.exists) throw new Error("Document not found");
  const data = snap.data();

  if (data.userId !== userId) throw new Error("Not authorized");
  if (isTerminalStatus(data.status)) {
    throw new Error("Cannot cancel a completed document");
  }
  if (!isValidTransition(data.status, DOCUMENT_STATUS.CANCELLED)) {
    throw new Error(`Cannot cancel from ${data.status}`);
  }

  await ref.update({
    status: DOCUMENT_STATUS.CANCELLED,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await cache.del(keys.certDoc(docId));
  await cache.invalidatePrefix(`userCertDocs:${userId}`);
  await cache.invalidatePrefix('queue:');

  return { id: docId, status: DOCUMENT_STATUS.CANCELLED };
};

/**
 * Get a single certified document by ID
 */
const getDocument = async (docId) => {
  return cache.getOrSet(keys.certDoc(docId), TTL.DOCUMENT, async () => {
    const snap = await getDb().collection(COLLECTION).doc(docId).get();
    return snap.exists ? snap.data() : null;
  });
};

/**
 * Get all documents for a user (returns only listing-safe fields)
 */
const getUserDocuments = async (userId, statusFilter) => {
  const cacheKey = keys.userCertDocs(userId, statusFilter);
  return cache.getOrSet(cacheKey, TTL.LIST, async () => {
    let query = getDb()
    .collection(COLLECTION)
    .where("userId", "==", userId)
    .where("isActive", "==", true)
    .orderBy("createdAt", "desc");

  if (statusFilter) {
    query = query.where("status", "==", statusFilter);
  }

  const snap = await query.get();
  return snap.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      formType: data.formType || null,
      sourceLanguage: data.sourceLanguage || null,
      targetLanguage: data.targetLanguage || null,
      status: data.status || null,
      speedTier: data.speedTier || null,
      bulletinId: data.bulletinId || null,
      certification: data.certification
        ? {
            certificationId: data.certification.certificationId || null,
            certifiedAt: data.certification.certifiedAt || null,
          }
        : null,
      originalData: data.originalData
        ? {
            studentName: data.originalData.studentName || null,
            documentTitle: data.originalData.documentTitle || null,
          }
        : null,
      certifiedData: data.certifiedData
        ? {
            studentName: data.certifiedData.studentName || null,
            documentTitle: data.certifiedData.documentTitle || null,
          }
        : null,
      review: data.review || null,
      createdAt: data.createdAt || null,
      submittedAt: data.submittedAt || null,
    };
  });
  });
};

/**
 * Get documents in the review queue (for translators)
 */
const getReviewQueue = async (statusFilter) => {
  const cacheKey = keys.queue(statusFilter);
  return cache.getOrSet(cacheKey, TTL.QUEUE, async () => {
    const statuses = statusFilter
      ? [statusFilter]
      : [DOCUMENT_STATUS.PENDING_REVIEW, DOCUMENT_STATUS.IN_REVIEW];

    const snap = await getDb()
      .collection(COLLECTION)
      .where("status", "in", statuses)
      .where("isActive", "==", true)
      .orderBy("createdAt", "asc")
      .get();

    return snap.docs.map((doc) => doc.data());
  });
};

/**
 * Get documents assigned to a specific translator
 */
const getAssignedDocuments = async (translatorId) => {
  const snap = await getDb()
    .collection(COLLECTION)
    .where("assignment.assignedTo", "==", translatorId)
    .where("status", "==", DOCUMENT_STATUS.IN_REVIEW)
    .where("isActive", "==", true)
    .get();

  return snap.docs.map((doc) => doc.data());
};

/**
 * Verify a certified document by certification ID (public)
 */
const verifyByCertificationId = async (certificationId) => {
  const cacheKey = keys.verification(certificationId);
  return cache.getOrSet(cacheKey, TTL.VERIFICATION, async () => {
    const snap = await getDb()
    .collection(COLLECTION)
    .where("certification.certificationId", "==", certificationId)
    .where("status", "==", DOCUMENT_STATUS.CERTIFIED)
    .limit(1)
    .get();

  if (snap.empty) return null;

  const data = snap.docs[0].data();

  // Fetch translator display name for agent info
  let certifiedByName = null;
  if (data.certification.certifiedBy) {
    try {
      const userSnap = await getDb()
        .collection("users")
        .doc(data.certification.certifiedBy)
        .get();
      if (userSnap.exists) {
        const userData = userSnap.data();
        certifiedByName = userData.displayName || userData.name || null;
      }
    } catch (_) {
      // Silently ignore if user lookup fails
    }
  }

  return {
    certificationId: data.certification.certificationId,
    certifiedAt: data.certification.certifiedAt,
    documentHash: data.certification.documentHash,
    certifiedByName,
    documentTitle: data.certifiedData?.documentTitle || data.originalData?.documentTitle || null,
    studentName: data.certifiedData?.studentName || data.originalData?.studentName,
    formType: data.formType,
    sourceLanguage: data.sourceLanguage,
    targetLanguage: data.targetLanguage,
  };
  });
};

module.exports = {
  createSubmission,
  submitForReview,
  claimForReview,
  releaseDocument,
  updateEditedData,
  certifyDocument,
  rejectDocument,
  cancelDocument,
  getDocument,
  getUserDocuments,
  getReviewQueue,
  getAssignedDocuments,
  verifyByCertificationId,
};

// Translator Routes for NTC
// Handles document queue, review workflow, and translator statistics

const express = require("express");
const { verifyToken } = require("../auth");
const {
  ROLES,
  PERMISSIONS,
  requireRole,
  requirePermission,
  attachRoleInfo,
} = require("../middleware/rbac");
const admin = require("firebase-admin");
const { getSignedUrl } = require("../services/storage");
const { cache, TTL, keys } = require("../services/cache");
const notifications = require("../services/notificationService");

const router = express.Router();
const db = admin.firestore();

// Apply role info middleware to all translator routes
router.use(attachRoleInfo());

// ============================================
// DOCUMENT QUEUE ROUTES
// ============================================

/**
 * GET /api/translator/queue
 * Get documents pending translation review
 * Merges documents from both 'documents' and 'certifiedDocuments' collections
 * Requires: Translator or Super Admin role
 */
router.get(
  "/queue",
  verifyToken,
  requireRole([ROLES.TRANSLATOR, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { status, priority, limit = 50, startAfter } = req.query;
      const parsedLimit = parseInt(limit, 10);

      // Build cache key from query params (skip cache if paginating with startAfter)
      const cacheKey = startAfter
        ? null
        : keys.queue(`${status || "default"}:${priority || "all"}:${parsedLimit}`);

      const fetchQueue = async () => {
        const validStatuses = status === "all"
          ? ["pending_review", "in_review", "ai_completed", "approved", "rejected", "certified", "draft"]
          : status
          ? [status]
          : ["pending_review", "in_review", "ai_completed"];

      // Query both collections in parallel
      let docsQuery = db
        .collection("documents")
        .where("status", "in", validStatuses);

      if (priority) {
        docsQuery = docsQuery.where("priority", "==", priority);
      }

      docsQuery = docsQuery.orderBy("createdAt", "asc").limit(parseInt(limit, 10));

      let certQuery = db
        .collection("certifiedDocuments")
        .where("status", "in", validStatuses)
        .where("isActive", "==", true)
        .orderBy("createdAt", "asc")
        .limit(parseInt(limit, 10));

      const [docsSnap, certSnap] = await Promise.all([
        docsQuery.get(),
        certQuery.get(),
      ]);

      const documents = [];

      // Map documents collection
      docsSnap.forEach((doc) => {
        const data = doc.data();
        documents.push({
          id: doc.id,
          userId: data.userId,
          userEmail: data.userEmail,
          formType: data.formType,
          status: data.status,
          priority: data.priority || "normal",
          studentName: data.studentName || data.extractedData?.studentName,
          schoolName: data.schoolName || data.extractedData?.schoolName,
          documentTitle: data.documentTitle || data.extractedData?.documentTitle,
          assignedTo: data.assignedTo,
          assignedToName: data.assignedToName,
          aiConfidenceScore: data.aiConfidenceScore,
          speedTier: data.speedTier || null,
          sourceLanguage: data.sourceLanguage || null,
          source: "documents",
          createdAt: data.createdAt?.toDate?.() || data.createdAt,
          updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
        });
      });

      // Map certifiedDocuments collection
      certSnap.forEach((doc) => {
        const data = doc.data();
        documents.push({
          id: doc.id,
          userId: data.userId,
          userEmail: data.userEmail,
          formType: data.formType,
          status: data.status,
          priority: data.speedTier?.id === "express" ? "urgent" : data.speedTier?.id === "rush" ? "high" : "normal",
          studentName: data.originalData?.academicInfo?.studentName || data.originalData?.studentName,
          schoolName: data.originalData?.academicInfo?.institution,
          documentTitle: data.originalData?.documentTitle,
          assignedTo: data.assignment?.assignedTo,
          assignedToName: null,
          aiConfidenceScore: null,
          speedTier: data.speedTier || null,
          sourceLanguage: data.sourceLanguage || null,
          source: "certifiedDocuments",
          rejectionHistory: data.rejectionHistory || [],
          resubmissionCount: data.resubmissionCount || 0,
          createdAt: data.createdAt?.toDate?.() || data.createdAt,
          updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
        });
      });

      // Sort merged results by creation date (oldest first)
      documents.sort((a, b) => {
        const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
        const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
        return aTime - bTime;
      });

      return {
        documents: documents.slice(0, parsedLimit),
        count: documents.length,
      };
      }; // end fetchQueue

      const result = cacheKey
        ? await cache.getOrSet(cacheKey, TTL.QUEUE, fetchQueue)
        : await fetchQueue();

      res.json({
        success: true,
        documents: result.documents,
        count: result.count,
      });
    } catch (error) {
      console.error("❌ Error fetching document queue:", error);
      res.status(500).json({
        error: "Failed to fetch document queue",
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/translator/queue/stats
 * Get queue statistics (merged from both collections)
 * Requires: Translator or Super Admin role
 */
router.get(
  "/queue/stats",
  verifyToken,
  requireRole([ROLES.TRANSLATOR, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const stats = await cache.getOrSet(keys.queueStats(), TTL.STATS, async () => {
        // Query both collections in parallel
        const statsPromises = [
          // documents collection
          db.collection("documents").where("status", "==", "pending_review").get(),
          db.collection("documents").where("status", "==", "in_review").get(),
          db.collection("documents").where("status", "==", "ai_completed").get(),
          db.collection("documents").where("status", "==", "approved").get(),
          db.collection("documents").where("status", "==", "rejected").get(),
          // certifiedDocuments collection
          db.collection("certifiedDocuments").where("status", "==", "pending_review").where("isActive", "==", true).get(),
          db.collection("certifiedDocuments").where("status", "==", "in_review").where("isActive", "==", true).get(),
          db.collection("certifiedDocuments").where("status", "==", "certified").where("isActive", "==", true).get(),
          db.collection("certifiedDocuments").where("status", "==", "rejected").where("isActive", "==", true).get(),
        ];

        const [
          pendingSnap, inReviewSnap, aiCompletedSnap, approvedSnap, rejectedSnap,
          certPendingSnap, certInReviewSnap, certApprovedSnap, certRejectedSnap,
        ] = await Promise.all(statsPromises);

        // Merge counts
        const pending = pendingSnap.size + certPendingSnap.size;
        const inReview = inReviewSnap.size + certInReviewSnap.size;
        const aiCompleted = aiCompletedSnap.size;
        const approved = approvedSnap.size + certApprovedSnap.size;
        const rejected = rejectedSnap.size + certRejectedSnap.size;

        // Get today's approved
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [todayApprovedSnap, todayCertifiedSnap] = await Promise.all([
          db.collection("documents").where("status", "==", "approved").where("approvedAt", ">=", today).get(),
          db.collection("certifiedDocuments").where("status", "==", "certified").where("certification.certifiedAt", ">=", today).get().catch(() => ({ size: 0 })),
        ]);

        return {
          pendingReview: pending,
          inReview: inReview,
          aiCompleted: aiCompleted,
          approved: approved,
          rejected: rejected,
          totalInQueue: pending + inReview + aiCompleted,
          approvedToday: todayApprovedSnap.size + (todayCertifiedSnap.size || 0),
        };
      });

      res.json({
        success: true,
        stats,
      });
    } catch (error) {
      console.error("❌ Error fetching queue stats:", error);
      res.status(500).json({
        error: "Failed to fetch queue statistics",
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/translator/assigned
 * Get documents assigned to current translator (from both collections)
 * Requires: Translator or Super Admin role
 */
router.get(
  "/assigned",
  verifyToken,
  requireRole([ROLES.TRANSLATOR, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const translatorUid = req.user.uid;
      const { status, limit = 20 } = req.query;

      // Query both collections
      let docsQuery = db
        .collection("documents")
        .where("assignedTo", "==", translatorUid);
      if (status) docsQuery = docsQuery.where("status", "==", status);
      docsQuery = docsQuery.orderBy("updatedAt", "desc").limit(parseInt(limit, 10));

      let certQuery = db
        .collection("certifiedDocuments")
        .where("assignment.assignedTo", "==", translatorUid)
        .where("isActive", "==", true);
      if (status) certQuery = certQuery.where("status", "==", status);
      certQuery = certQuery.orderBy("updatedAt", "desc").limit(parseInt(limit, 10));

      const [docsSnap, certSnap] = await Promise.all([
        docsQuery.get(),
        certQuery.get(),
      ]);

      const documents = [];

      docsSnap.forEach((doc) => {
        const data = doc.data();
        documents.push({
          id: doc.id,
          userId: data.userId,
          userEmail: data.userEmail,
          formType: data.formType,
          status: data.status,
          priority: data.priority || "normal",
          studentName: data.studentName || data.extractedData?.studentName,
          schoolName: data.schoolName || data.extractedData?.schoolName,
          documentTitle: data.documentTitle || data.extractedData?.documentTitle,
          aiConfidenceScore: data.aiConfidenceScore,
          speedTier: data.speedTier || null,
          source: "documents",
          createdAt: data.createdAt?.toDate?.() || data.createdAt,
          updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
          assignedAt: data.assignedAt?.toDate?.() || data.assignedAt,
        });
      });

      certSnap.forEach((doc) => {
        const data = doc.data();
        documents.push({
          id: doc.id,
          userId: data.userId,
          userEmail: data.userEmail,
          formType: data.formType,
          status: data.status,
          priority: data.speedTier?.id === "express" ? "urgent" : data.speedTier?.id === "rush" ? "high" : "normal",
          studentName: data.originalData?.academicInfo?.studentName || data.originalData?.studentName,
          schoolName: data.originalData?.academicInfo?.institution,
          documentTitle: data.originalData?.documentTitle,
          aiConfidenceScore: null,
          speedTier: data.speedTier || null,
          source: "certifiedDocuments",
          createdAt: data.createdAt?.toDate?.() || data.createdAt,
          updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
          assignedAt: data.assignment?.assignedAt?.toDate?.() || data.assignment?.assignedAt,
        });
      });

      // Sort by most recently updated
      documents.sort((a, b) => {
        const aTime = a.updatedAt instanceof Date ? a.updatedAt.getTime() : new Date(a.updatedAt).getTime();
        const bTime = b.updatedAt instanceof Date ? b.updatedAt.getTime() : new Date(b.updatedAt).getTime();
        return bTime - aTime;
      });

      res.json({
        success: true,
        documents: documents.slice(0, parseInt(limit, 10)),
        count: documents.length,
      });
    } catch (error) {
      console.error("❌ Error fetching assigned documents:", error);
      res.status(500).json({
        error: "Failed to fetch assigned documents",
        message: error.message,
      });
    }
  }
);

// ============================================
// DOCUMENT REVIEW ROUTES
// ============================================

/**
 * GET /api/translator/document/:docId
 * Get full document details for review (checks both collections)
 * Requires: Translator or Super Admin role
 */
router.get(
  "/document/:docId",
  verifyToken,
  requireRole([ROLES.TRANSLATOR, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { docId } = req.params;

      // Try documents collection first
      let docRef = db.collection("documents").doc(docId);
      let docSnap = await docRef.get();
      let source = "documents";

      // If not found, try certifiedDocuments
      if (!docSnap.exists) {
        docRef = db.collection("certifiedDocuments").doc(docId);
        docSnap = await docRef.get();
        source = "certifiedDocuments";
      }

      if (!docSnap.exists) {
        return res.status(404).json({
          error: "Document not found",
        });
      }

      const data = docSnap.data();

      // Get revision history from the correct collection
      const revisions = [];
      try {
        const revisionsSnap = await docRef
          .collection("revisions")
          .orderBy(source === "certifiedDocuments" ? "timestamp" : "createdAt", "desc")
          .limit(10)
          .get();

        revisionsSnap.forEach((rev) => {
          const revData = rev.data();
          revisions.push({
            id: rev.id,
            translatorId: revData.translatorId || revData.editedBy,
            translatorName: revData.translatorName || revData.editedBy,
            changes: revData.changes || "Edit",
            comment: revData.comment,
            createdAt: (revData.createdAt || revData.timestamp)?.toDate?.() || revData.createdAt || revData.timestamp,
          });
        });
      } catch (revError) {
        console.warn("Could not fetch revisions:", revError.message);
      }

      // Build normalized response based on source collection
      let document;
      if (source === "certifiedDocuments") {
        // Get fresh signed URL for original file
        let freshOriginalUrl = data.metadata?.storageUrl;
        if (data.metadata?.storagePath) {
          try {
            const urlResult = await getSignedUrl(data.metadata.storagePath, 120);
            if (urlResult.success) freshOriginalUrl = urlResult.url;
          } catch (e) {
            console.warn("Could not refresh signed URL:", e.message);
          }
        }

        document = {
          id: docSnap.id,
          userId: data.userId,
          userEmail: data.userEmail,
          formType: data.formType,
          status: data.status,
          priority: data.speedTier?.id === "express" ? "urgent" : data.speedTier?.id === "rush" ? "high" : "normal",
          originalFileUrl: freshOriginalUrl,
          originalFileName: data.metadata?.fileName,
          extractedData: data.originalData,
          translatedData: data.editedData || data.originalData,
          aiConfidenceScore: null,
          aiNotes: null,
          assignedTo: data.assignment?.assignedTo,
          assignedToName: null,
          assignedAt: data.assignment?.claimedAt?.toDate?.() || data.assignment?.claimedAt,
          reviewNotes: data.review?.rejectionReason,
          approvedBy: data.certification?.certifiedBy || data.review?.reviewedBy,
          approvedByName: null,
          approvedAt: data.certification?.certifiedAt?.toDate?.() || data.review?.reviewedAt?.toDate?.(),
          speedTier: data.speedTier || null,
          sourceLanguage: data.sourceLanguage || null,
          source: "certifiedDocuments",
          documentTitle: data.originalData?.documentTitle,
          createdAt: data.createdAt?.toDate?.() || data.createdAt,
          updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
        };
      } else {
        // For documents collection, also try to get fresh signed URL
        let freshOriginalUrl = data.originalFileUrl;
        const storagePath = data.metadata?.storagePath || data.storagePath;
        if (storagePath) {
          try {
            const urlResult = await getSignedUrl(storagePath, 120);
            if (urlResult.success) freshOriginalUrl = urlResult.url;
          } catch (e) {
            console.warn("Could not refresh signed URL for documents:", e.message);
          }
        }

        document = {
          id: docSnap.id,
          userId: data.userId,
          userEmail: data.userEmail,
          formType: data.formType,
          status: data.status,
          priority: data.priority || "normal",
          originalFileUrl: freshOriginalUrl,
          originalFileName: data.metadata?.fileName || data.originalFileName,
          extractedData: data.extractedData,
          translatedData: data.translatedData,
          aiConfidenceScore: data.aiConfidenceScore,
          aiNotes: data.aiNotes,
          assignedTo: data.assignedTo,
          assignedToName: data.assignedToName,
          assignedAt: data.assignedAt?.toDate?.() || data.assignedAt,
          reviewNotes: data.reviewNotes,
          approvedBy: data.approvedBy,
          approvedByName: data.approvedByName,
          approvedAt: data.approvedAt?.toDate?.() || data.approvedAt,
          speedTier: data.speedTier || null,
          sourceLanguage: data.sourceLanguage || null,
          source: "documents",
          documentTitle: data.documentTitle || data.extractedData?.documentTitle,
          createdAt: data.createdAt?.toDate?.() || data.createdAt,
          updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
        };
      }

      res.json({
        success: true,
        document,
        revisions,
      });
    } catch (error) {
      console.error("❌ Error fetching document:", error);
      res.status(500).json({
        error: "Failed to fetch document",
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/translator/document/:docId/claim
 * Claim a document for review (checks both collections)
 * Requires: Translator or Super Admin role
 */
router.post(
  "/document/:docId/claim",
  verifyToken,
  requireRole([ROLES.TRANSLATOR, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { docId } = req.params;
      const translatorUid = req.user.uid;
      const translatorName = req.user.name || req.user.email;

      // Try documents collection first
      let docRef = db.collection("documents").doc(docId);
      let docSnap = await docRef.get();
      let source = "documents";

      // If not found, try certifiedDocuments
      if (!docSnap.exists) {
        docRef = db.collection("certifiedDocuments").doc(docId);
        docSnap = await docRef.get();
        source = "certifiedDocuments";
      }

      if (!docSnap.exists) {
        return res.status(404).json({
          error: "Document not found",
        });
      }

      const data = docSnap.data();

      // Check if already assigned to someone else
      const assignedTo = source === "certifiedDocuments"
        ? data.assignment?.assignedTo
        : data.assignedTo;

      if (assignedTo && assignedTo !== translatorUid) {
        return res.status(409).json({
          error: "Document already assigned",
          assignedTo: source === "certifiedDocuments" ? null : data.assignedToName,
        });
      }

      // Update document based on collection type
      if (source === "certifiedDocuments") {
        await docRef.update({
          "assignment.assignedTo": translatorUid,
          "assignment.claimedAt": admin.firestore.FieldValue.serverTimestamp(),
          status: "in_review",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        await docRef.update({
          assignedTo: translatorUid,
          assignedToName: translatorName,
          assignedAt: admin.firestore.FieldValue.serverTimestamp(),
          status: "in_review",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // Log activity
      await db.collection("activityLogs").add({
        type: "document_claimed",
        documentId: docId,
        translatorId: translatorUid,
        translatorName,
        source,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Invalidate caches
      await cache.del(keys.doc(docId));
      await cache.del(keys.certDoc(docId));
      await cache.invalidatePrefix("queue:");
      await cache.del(keys.queueStats());

      // Send notification/email to document owner
      try {
        await notifications.onDocumentClaimed(
          { userId: data.userId, id: docId, formType: data.formType },
          translatorUid
        );
      } catch (notifErr) {
        console.error("⚠️ Failed to send claim notification:", notifErr.message);
      }

      res.json({
        success: true,
        message: "Document claimed successfully",
      });
    } catch (error) {
      console.error("❌ Error claiming document:", error);
      res.status(500).json({
        error: "Failed to claim document",
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/translator/document/:docId/release
 * Release a claimed document back to queue
 * Requires: Translator or Super Admin role
 */
router.post(
  "/document/:docId/release",
  verifyToken,
  requireRole([ROLES.TRANSLATOR, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { docId } = req.params;
      const translatorUid = req.user.uid;
      const { reason } = req.body;

      // Try documents collection first
      let docRef = db.collection("documents").doc(docId);
      let docSnap = await docRef.get();
      let source = "documents";

      if (!docSnap.exists) {
        docRef = db.collection("certifiedDocuments").doc(docId);
        docSnap = await docRef.get();
        source = "certifiedDocuments";
      }

      if (!docSnap.exists) {
        return res.status(404).json({
          error: "Document not found",
        });
      }

      const data = docSnap.data();

      // Only assigned translator or super admin can release
      const assignedTo = source === "certifiedDocuments"
        ? data.assignment?.assignedTo
        : data.assignedTo;

      if (
        assignedTo !== translatorUid &&
        req.user.role !== ROLES.SUPER_ADMIN
      ) {
        return res.status(403).json({
          error: "You can only release documents assigned to you",
        });
      }

      // Update document based on collection type
      if (source === "certifiedDocuments") {
        await docRef.update({
          "assignment.assignedTo": null,
          "assignment.claimedAt": null,
          status: "pending_review",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        await docRef.update({
          assignedTo: null,
          assignedToName: null,
          assignedAt: null,
          status: "pending_review",
          releaseReason: reason || null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // Log activity
      await db.collection("activityLogs").add({
        type: "document_released",
        documentId: docId,
        translatorId: translatorUid,
        reason,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Invalidate caches
      await cache.del(keys.doc(docId));
      await cache.del(keys.certDoc(docId));
      await cache.invalidatePrefix("queue:");
      await cache.del(keys.queueStats());

      res.json({
        success: true,
        message: "Document released back to queue",
      });
    } catch (error) {
      console.error("❌ Error releasing document:", error);
      res.status(500).json({
        error: "Failed to release document",
        message: error.message,
      });
    }
  }
);

/**
 * PUT /api/translator/document/:docId/update
 * Update translated data (save draft)
 * Requires: Translator or Super Admin role
 */
router.put(
  "/document/:docId/update",
  verifyToken,
  requireRole([ROLES.TRANSLATOR, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { docId } = req.params;
      const translatorUid = req.user.uid;
      const { translatedData, reviewNotes } = req.body;

      // Try documents collection first
      let docRef = db.collection("documents").doc(docId);
      let docSnap = await docRef.get();
      let source = "documents";

      if (!docSnap.exists) {
        docRef = db.collection("certifiedDocuments").doc(docId);
        docSnap = await docRef.get();
        source = "certifiedDocuments";
      }

      if (!docSnap.exists) {
        return res.status(404).json({
          error: "Document not found",
        });
      }

      const data = docSnap.data();

      // Only assigned translator can update
      const assignedTo = source === "certifiedDocuments"
        ? data.assignment?.assignedTo
        : data.assignedTo;

      if (
        assignedTo !== translatorUid &&
        req.user.role !== ROLES.SUPER_ADMIN
      ) {
        return res.status(403).json({
          error: "You can only update documents assigned to you",
        });
      }

      if (source === "certifiedDocuments") {
        // Save revision
        await docRef.collection("revisions").add({
          editedBy: translatorUid,
          data: translatedData,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });

        const updateData = {
          editedData: translatedData,
          "metadata.lastModified": admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        await docRef.update(updateData);
      } else {
        // Create revision record
        const previousData = data.translatedData;
        await docRef.collection("revisions").add({
          translatorId: translatorUid,
          translatorName: req.user.name || req.user.email,
          previousData,
          newData: translatedData,
          changes: req.body.changes || "Manual update",
          comment: reviewNotes,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        const updateData = {
          translatedData,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          lastEditedBy: translatorUid,
          lastEditedByName: req.user.name || req.user.email,
        };

        if (reviewNotes !== undefined) {
          updateData.reviewNotes = reviewNotes;
        }

        await docRef.update(updateData);
      }

      res.json({
        success: true,
        message: "Document updated successfully",
      });
    } catch (error) {
      console.error("❌ Error updating document:", error);
      res.status(500).json({
        error: "Failed to update document",
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/translator/document/:docId/approve
 * Approve document translation
 * Requires: Translator or Super Admin role
 */
router.post(
  "/document/:docId/approve",
  verifyToken,
  requireRole([ROLES.TRANSLATOR, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { docId } = req.params;
      const translatorUid = req.user.uid;
      const translatorName = req.user.name || req.user.email;
      const { finalNotes } = req.body;

      // Try documents collection first
      let docRef = db.collection("documents").doc(docId);
      let docSnap = await docRef.get();
      let source = "documents";

      if (!docSnap.exists) {
        docRef = db.collection("certifiedDocuments").doc(docId);
        docSnap = await docRef.get();
        source = "certifiedDocuments";
      }

      if (!docSnap.exists) {
        return res.status(404).json({
          error: "Document not found",
        });
      }

      const data = docSnap.data();

      // Only assigned translator or super admin can approve
      const assignedTo = source === "certifiedDocuments"
        ? data.assignment?.assignedTo
        : data.assignedTo;

      if (
        assignedTo !== translatorUid &&
        req.user.role !== ROLES.SUPER_ADMIN
      ) {
        return res.status(403).json({
          error: "You can only approve documents assigned to you",
        });
      }

      if (source === "certifiedDocuments") {
        const { generateCertificationId } = require("../constants/certificationIds");
        const certifiedData = data.editedData || data.originalData;
        const certificationId = generateCertificationId();
        await docRef.update({
          status: "certified",
          certifiedData,
          certification: {
            certificationId,
            certifiedBy: translatorUid,
            certifiedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          "review.reviewedBy": translatorUid,
          "review.reviewedAt": admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        // Store certificationId for notification below
        data._certificationId = certificationId;
      } else {
        await docRef.update({
          status: "approved",
          approvedBy: translatorUid,
          approvedByName: translatorName,
          approvedAt: admin.firestore.FieldValue.serverTimestamp(),
          finalNotes: finalNotes || null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // Log activity
      await db.collection("activityLogs").add({
        type: "document_approved",
        documentId: docId,
        translatorId: translatorUid,
        translatorName,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Update translator stats
      const translatorRef = db.collection("users").doc(translatorUid);
      await translatorRef.update({
        "stats.documentsApproved": admin.firestore.FieldValue.increment(1),
        "stats.lastApprovalAt": admin.firestore.FieldValue.serverTimestamp(),
      });

      // Invalidate caches
      await cache.del(keys.doc(docId));
      await cache.del(keys.certDoc(docId));
      await cache.invalidatePrefix("queue:");
      await cache.del(keys.queueStats());
      await cache.invalidatePrefix(`translatorStats:${translatorUid}`);
      await cache.del(keys.translatorLeaderboard());
      await cache.del(keys.user(translatorUid));

      // Send notification/email to document owner
      try {
        const certId = data._certificationId || docId;
        await notifications.onDocumentCertified(
          { userId: data.userId, id: docId, formType: data.formType },
          certId
        );
      } catch (notifErr) {
        console.error("⚠️ Failed to send approval notification:", notifErr.message);
      }

      res.json({
        success: true,
        message: "Document approved successfully",
      });
    } catch (error) {
      console.error("❌ Error approving document:", error);
      res.status(500).json({
        error: "Failed to approve document",
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/translator/document/:docId/reject
 * Reject document (needs re-upload or manual handling)
 * Requires: Translator or Super Admin role
 */
router.post(
  "/document/:docId/reject",
  verifyToken,
  requireRole([ROLES.TRANSLATOR, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { docId } = req.params;
      const translatorUid = req.user.uid;
      const translatorName = req.user.name || req.user.email;
      const { reason, rejectionType } = req.body;

      if (!reason) {
        return res.status(400).json({
          error: "Rejection reason is required",
        });
      }

      // Try documents collection first
      let docRef = db.collection("documents").doc(docId);
      let docSnap = await docRef.get();
      let source = "documents";

      if (!docSnap.exists) {
        docRef = db.collection("certifiedDocuments").doc(docId);
        docSnap = await docRef.get();
        source = "certifiedDocuments";
      }

      if (!docSnap.exists) {
        return res.status(404).json({
          error: "Document not found",
        });
      }

      // Update document based on collection type
      if (source === "certifiedDocuments") {
        await docRef.update({
          status: "rejected",
          "review.reviewedBy": translatorUid,
          "review.reviewedAt": admin.firestore.FieldValue.serverTimestamp(),
          "review.rejectionReason": reason,
          "review.rejectionType": rejectionType || "quality",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        await docRef.update({
          status: "rejected",
          rejectedBy: translatorUid,
          rejectedByName: translatorName,
          rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
          rejectionReason: reason,
          rejectionType: rejectionType || "quality",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // Log activity
      await db.collection("activityLogs").add({
        type: "document_rejected",
        documentId: docId,
        translatorId: translatorUid,
        translatorName,
        reason,
        rejectionType,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Invalidate caches
      await cache.del(keys.doc(docId));
      await cache.del(keys.certDoc(docId));
      await cache.invalidatePrefix("queue:");
      await cache.del(keys.queueStats());
      await cache.invalidatePrefix(`translatorStats:${translatorUid}`);
      await cache.del(keys.translatorLeaderboard());

      // Send notification/email to document owner
      try {
        const docData = docSnap.data();
        await notifications.onDocumentRejected(
          { userId: docData.userId, id: docId, formType: docData.formType },
          reason,
          rejectionType || "quality"
        );
      } catch (notifErr) {
        console.error("⚠️ Failed to send rejection notification:", notifErr.message);
      }

      res.json({
        success: true,
        message: "Document rejected",
      });
    } catch (error) {
      console.error("❌ Error rejecting document:", error);
      res.status(500).json({
        error: "Failed to reject document",
        message: error.message,
      });
    }
  }
);

// ============================================
// TRANSLATOR STATISTICS ROUTES
// ============================================

/**
 * GET /api/translator/stats
 * Get current translator's performance statistics
 * Requires: Translator or Super Admin role
 */
router.get(
  "/stats",
  verifyToken,
  requireRole([ROLES.TRANSLATOR, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const translatorUid = req.user.uid;
      const { period = "month" } = req.query; // day, week, month, year, all

      const statsCacheKey = `${keys.translatorStats(translatorUid)}:${period}`;
      const stats = await cache.getOrSet(statsCacheKey, TTL.STATS, async () => {
        // Calculate date range
        const now = new Date();
        let startDate;

        switch (period) {
          case "day":
            startDate = new Date(now.setHours(0, 0, 0, 0));
            break;
          case "week":
            startDate = new Date(now.setDate(now.getDate() - 7));
            break;
          case "month":
            startDate = new Date(now.setMonth(now.getMonth() - 1));
            break;
          case "year":
            startDate = new Date(now.setFullYear(now.getFullYear() - 1));
            break;
          default:
            startDate = null;
        }

        // Get approved documents count
        let approvedQuery = db
          .collection("documents")
          .where("approvedBy", "==", translatorUid);

        if (startDate) {
          approvedQuery = approvedQuery.where("approvedAt", ">=", startDate);
        }

        const approvedSnap = await approvedQuery.get();

        // Get rejected documents count
        let rejectedQuery = db
          .collection("documents")
          .where("rejectedBy", "==", translatorUid);

        if (startDate) {
          rejectedQuery = rejectedQuery.where("rejectedAt", ">=", startDate);
        }

        const rejectedSnap = await rejectedQuery.get();

        // Get currently assigned (in progress)
        const inProgressSnap = await db
          .collection("documents")
          .where("assignedTo", "==", translatorUid)
          .where("status", "==", "in_review")
          .get();

        // Get user's stored stats
        const userDoc = await db.collection("users").doc(translatorUid).get();
        const userData = userDoc.data();

        // Calculate average review time (from activity logs)
        let avgReviewTimeMinutes = null;
        const recentApprovals = await db
          .collection("activityLogs")
          .where("translatorId", "==", translatorUid)
          .where("type", "==", "document_approved")
          .orderBy("timestamp", "desc")
          .limit(50)
          .get();

        return {
          period,
          approved: approvedSnap.size,
          rejected: rejectedSnap.size,
          inProgress: inProgressSnap.size,
          totalReviewed: approvedSnap.size + rejectedSnap.size,
          approvalRate:
            approvedSnap.size + rejectedSnap.size > 0
              ? (
                  (approvedSnap.size /
                    (approvedSnap.size + rejectedSnap.size)) *
                  100
                ).toFixed(1)
              : 0,
          avgReviewTimeMinutes,
          allTimeStats: userData?.stats || {
            documentsApproved: 0,
            documentsRejected: 0,
          },
        };
      });

      res.json({
        success: true,
        stats,
      });
    } catch (error) {
      console.error("❌ Error fetching translator stats:", error);
      res.status(500).json({
        error: "Failed to fetch statistics",
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/translator/stats/leaderboard
 * Get translator leaderboard
 * Requires: Translator or Super Admin role
 */
router.get(
  "/stats/leaderboard",
  verifyToken,
  requireRole([ROLES.TRANSLATOR, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { period = "month", limit = 10 } = req.query;

      const leaderboard = await cache.getOrSet(keys.translatorLeaderboard(), TTL.STATS, async () => {
        // Get all translators
        const translatorsSnap = await db
          .collection("users")
          .where("role", "==", "translator")
          .where("isActive", "==", true)
          .get();

        const board = [];

        for (const doc of translatorsSnap.docs) {
          const translator = doc.data();

          // Get approved count for period
          const approvedSnap = await db
            .collection("documents")
            .where("approvedBy", "==", doc.id)
            .get();

          board.push({
            uid: doc.id,
            displayName: translator.displayName || translator.email,
            photoURL: translator.photoURL,
            documentsApproved: approvedSnap.size,
            stats: translator.stats || {},
          });
        }

        // Sort by documents approved
        board.sort((a, b) => b.documentsApproved - a.documentsApproved);
        return board;
      });

      res.json({
        success: true,
        leaderboard: leaderboard.slice(0, parseInt(limit, 10)),
        period,
      });
    } catch (error) {
      console.error("❌ Error fetching leaderboard:", error);
      res.status(500).json({
        error: "Failed to fetch leaderboard",
        message: error.message,
      });
    }
  }
);

// ============================================
// NOTIFICATION ROUTES
// ============================================

/**
 * GET /api/translator/notifications
 * Get translator notifications
 * Requires: Translator or Super Admin role
 */
router.get(
  "/notifications",
  verifyToken,
  requireRole([ROLES.TRANSLATOR, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const translatorUid = req.user.uid;
      const { unreadOnly = false, limit = 20 } = req.query;

      let query = db
        .collection("notifications")
        .where("recipientId", "==", translatorUid)
        .orderBy("createdAt", "desc");

      if (unreadOnly === "true") {
        query = query.where("read", "==", false);
      }

      query = query.limit(parseInt(limit, 10));

      const snapshot = await query.get();
      const notifications = [];

      snapshot.forEach((doc) => {
        const data = doc.data();
        notifications.push({
          id: doc.id,
          type: data.type,
          title: data.title,
          message: data.message,
          documentId: data.documentId,
          read: data.read,
          createdAt: data.createdAt?.toDate?.() || data.createdAt,
        });
      });

      res.json({
        success: true,
        notifications,
        count: notifications.length,
      });
    } catch (error) {
      console.error("❌ Error fetching notifications:", error);
      res.status(500).json({
        error: "Failed to fetch notifications",
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/translator/notifications/:notifId/read
 * Mark notification as read
 * Requires: Translator or Super Admin role
 */
router.post(
  "/notifications/:notifId/read",
  verifyToken,
  requireRole([ROLES.TRANSLATOR, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { notifId } = req.params;

      await db.collection("notifications").doc(notifId).update({
        read: true,
        readAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      res.json({
        success: true,
        message: "Notification marked as read",
      });
    } catch (error) {
      console.error("❌ Error marking notification as read:", error);
      res.status(500).json({
        error: "Failed to update notification",
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/translator/notifications/read-all
 * Mark all notifications as read
 * Requires: Translator or Super Admin role
 */
router.post(
  "/notifications/read-all",
  verifyToken,
  requireRole([ROLES.TRANSLATOR, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const translatorUid = req.user.uid;

      const unreadSnap = await db
        .collection("notifications")
        .where("recipientId", "==", translatorUid)
        .where("read", "==", false)
        .get();

      const batch = db.batch();
      unreadSnap.forEach((doc) => {
        batch.update(doc.ref, {
          read: true,
          readAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      await batch.commit();

      res.json({
        success: true,
        message: `Marked ${unreadSnap.size} notifications as read`,
      });
    } catch (error) {
      console.error("❌ Error marking all notifications as read:", error);
      res.status(500).json({
        error: "Failed to update notifications",
        message: error.message,
      });
    }
  }
);

module.exports = router;

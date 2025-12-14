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
 * Requires: Translator or Super Admin role
 */
router.get(
  "/queue",
  verifyToken,
  requireRole([ROLES.TRANSLATOR, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { status, priority, limit = 20, startAfter } = req.query;

      let query = db
        .collection("documents")
        .where("status", "in", ["pending_review", "in_review", "ai_completed"]);

      // Filter by specific status if provided
      if (status) {
        query = db.collection("documents").where("status", "==", status);
      }

      // Filter by priority
      if (priority) {
        query = query.where("priority", "==", priority);
      }

      // Order by priority (high first) then by creation date
      query = query.orderBy("priority", "desc").orderBy("createdAt", "asc");

      // Pagination
      if (startAfter) {
        const startDoc = await db.collection("documents").doc(startAfter).get();
        if (startDoc.exists) {
          query = query.startAfter(startDoc);
        }
      }

      query = query.limit(parseInt(limit, 10));

      const snapshot = await query.get();
      const documents = [];

      snapshot.forEach((doc) => {
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
          assignedTo: data.assignedTo,
          assignedToName: data.assignedToName,
          aiConfidenceScore: data.aiConfidenceScore,
          createdAt: data.createdAt?.toDate?.() || data.createdAt,
          updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
        });
      });

      res.json({
        success: true,
        documents,
        count: documents.length,
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
 * Get queue statistics
 * Requires: Translator or Super Admin role
 */
router.get(
  "/queue/stats",
  verifyToken,
  requireRole([ROLES.TRANSLATOR, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const statsPromises = [
        db
          .collection("documents")
          .where("status", "==", "pending_review")
          .get(),
        db.collection("documents").where("status", "==", "in_review").get(),
        db.collection("documents").where("status", "==", "ai_completed").get(),
        db.collection("documents").where("status", "==", "approved").get(),
        db.collection("documents").where("status", "==", "rejected").get(),
      ];

      const [
        pendingSnap,
        inReviewSnap,
        aiCompletedSnap,
        approvedSnap,
        rejectedSnap,
      ] = await Promise.all(statsPromises);

      // Get today's stats
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const todayApprovedSnap = await db
        .collection("documents")
        .where("status", "==", "approved")
        .where("approvedAt", ">=", today)
        .get();

      res.json({
        success: true,
        stats: {
          pendingReview: pendingSnap.size,
          inReview: inReviewSnap.size,
          aiCompleted: aiCompletedSnap.size,
          approved: approvedSnap.size,
          rejected: rejectedSnap.size,
          totalInQueue:
            pendingSnap.size + inReviewSnap.size + aiCompletedSnap.size,
          approvedToday: todayApprovedSnap.size,
        },
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
 * Get documents assigned to current translator
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

      let query = db
        .collection("documents")
        .where("assignedTo", "==", translatorUid);

      if (status) {
        query = query.where("status", "==", status);
      }

      query = query.orderBy("updatedAt", "desc").limit(parseInt(limit, 10));

      const snapshot = await query.get();
      const documents = [];

      snapshot.forEach((doc) => {
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
          aiConfidenceScore: data.aiConfidenceScore,
          createdAt: data.createdAt?.toDate?.() || data.createdAt,
          updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
          assignedAt: data.assignedAt?.toDate?.() || data.assignedAt,
        });
      });

      res.json({
        success: true,
        documents,
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
 * Get full document details for review
 * Requires: Translator or Super Admin role
 */
router.get(
  "/document/:docId",
  verifyToken,
  requireRole([ROLES.TRANSLATOR, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { docId } = req.params;

      const docRef = db.collection("documents").doc(docId);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        return res.status(404).json({
          error: "Document not found",
        });
      }

      const data = docSnap.data();

      // Get revision history
      const revisionsSnap = await docRef
        .collection("revisions")
        .orderBy("createdAt", "desc")
        .limit(10)
        .get();

      const revisions = [];
      revisionsSnap.forEach((rev) => {
        const revData = rev.data();
        revisions.push({
          id: rev.id,
          translatorId: revData.translatorId,
          translatorName: revData.translatorName,
          changes: revData.changes,
          comment: revData.comment,
          createdAt: revData.createdAt?.toDate?.() || revData.createdAt,
        });
      });

      res.json({
        success: true,
        document: {
          id: docSnap.id,
          userId: data.userId,
          userEmail: data.userEmail,
          formType: data.formType,
          status: data.status,
          priority: data.priority || "normal",
          originalFileUrl: data.originalFileUrl,
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
          createdAt: data.createdAt?.toDate?.() || data.createdAt,
          updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
        },
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
 * Claim a document for review (assign to self)
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

      const docRef = db.collection("documents").doc(docId);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        return res.status(404).json({
          error: "Document not found",
        });
      }

      const data = docSnap.data();

      // Check if already assigned to someone else
      if (data.assignedTo && data.assignedTo !== translatorUid) {
        return res.status(409).json({
          error: "Document already assigned",
          assignedTo: data.assignedToName,
        });
      }

      // Update document
      await docRef.update({
        assignedTo: translatorUid,
        assignedToName: translatorName,
        assignedAt: admin.firestore.FieldValue.serverTimestamp(),
        status: "in_review",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Log activity
      await db.collection("activityLogs").add({
        type: "document_claimed",
        documentId: docId,
        translatorId: translatorUid,
        translatorName,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

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

      const docRef = db.collection("documents").doc(docId);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        return res.status(404).json({
          error: "Document not found",
        });
      }

      const data = docSnap.data();

      // Only assigned translator or super admin can release
      if (
        data.assignedTo !== translatorUid &&
        req.user.role !== ROLES.SUPER_ADMIN
      ) {
        return res.status(403).json({
          error: "You can only release documents assigned to you",
        });
      }

      // Update document
      await docRef.update({
        assignedTo: null,
        assignedToName: null,
        assignedAt: null,
        status: "pending_review",
        releaseReason: reason || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Log activity
      await db.collection("activityLogs").add({
        type: "document_released",
        documentId: docId,
        translatorId: translatorUid,
        reason,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

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

      const docRef = db.collection("documents").doc(docId);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        return res.status(404).json({
          error: "Document not found",
        });
      }

      const data = docSnap.data();

      // Only assigned translator can update
      if (
        data.assignedTo !== translatorUid &&
        req.user.role !== ROLES.SUPER_ADMIN
      ) {
        return res.status(403).json({
          error: "You can only update documents assigned to you",
        });
      }

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

      // Update document
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

      const docRef = db.collection("documents").doc(docId);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        return res.status(404).json({
          error: "Document not found",
        });
      }

      const data = docSnap.data();

      // Only assigned translator or super admin can approve
      if (
        data.assignedTo !== translatorUid &&
        req.user.role !== ROLES.SUPER_ADMIN
      ) {
        return res.status(403).json({
          error: "You can only approve documents assigned to you",
        });
      }

      // Update document
      await docRef.update({
        status: "approved",
        approvedBy: translatorUid,
        approvedByName: translatorName,
        approvedAt: admin.firestore.FieldValue.serverTimestamp(),
        finalNotes: finalNotes || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

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

      const docRef = db.collection("documents").doc(docId);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        return res.status(404).json({
          error: "Document not found",
        });
      }

      // Update document
      await docRef.update({
        status: "rejected",
        rejectedBy: translatorUid,
        rejectedByName: translatorName,
        rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
        rejectionReason: reason,
        rejectionType: rejectionType || "quality", // quality, illegible, incomplete, wrong_format
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

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

      res.json({
        success: true,
        stats: {
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
        },
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

      // Get all translators
      const translatorsSnap = await db
        .collection("users")
        .where("role", "==", "translator")
        .where("isActive", "==", true)
        .get();

      const leaderboard = [];

      for (const doc of translatorsSnap.docs) {
        const translator = doc.data();

        // Get approved count for period
        const approvedSnap = await db
          .collection("documents")
          .where("approvedBy", "==", doc.id)
          .get();

        leaderboard.push({
          uid: doc.id,
          displayName: translator.displayName || translator.email,
          photoURL: translator.photoURL,
          documentsApproved: approvedSnap.size,
          stats: translator.stats || {},
        });
      }

      // Sort by documents approved
      leaderboard.sort((a, b) => b.documentsApproved - a.documentsApproved);

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

// Admin Routes for NTC
// Handles user management, partner management, and system administration

const express = require("express");
const { verifyToken } = require("../auth");
const {
  ROLES,
  PERMISSIONS,
  requireRole,
  requirePermission,
  attachRoleInfo,
} = require("../middleware/rbac");
const userService = require("../services/userService");
const admin = require("firebase-admin");
const { cache, TTL, keys } = require("../services/cache");
const { logActivity, getLogs } = require("../services/activityLogService");
const { deleteFromStorage } = require("../services/storage");
const notifications = require("../services/notificationService");

const router = express.Router();

// Helper function to convert Firestore Timestamp to ISO string
const convertTimestamp = (timestamp) => {
  if (!timestamp) return null;
  // Handle Firestore Timestamp object
  if (timestamp._seconds !== undefined) {
    return new Date(timestamp._seconds * 1000).toISOString();
  }
  // Handle Firestore Timestamp with toDate() method
  if (typeof timestamp.toDate === "function") {
    return timestamp.toDate().toISOString();
  }
  // Handle already converted string or Date
  if (typeof timestamp === "string") {
    return timestamp;
  }
  if (timestamp instanceof Date) {
    return timestamp.toISOString();
  }
  return null;
};

// Apply role info middleware to all admin routes
router.use(attachRoleInfo());

// ============================================
// USER MANAGEMENT ROUTES
// ============================================

/**
 * GET /api/admin/users
 * Get all users with optional filters
 * Requires: Super Admin or Support role
 */
router.get(
  "/users",
  verifyToken,
  requirePermission(PERMISSIONS.VIEW_ALL_USERS),
  async (req, res) => {
    try {
      const { role, partnerId, isActive, limit, startAfter } = req.query;

      const filters = {
        role: role || undefined,
        partnerId: partnerId || undefined,
        isActive:
          isActive === "true" ? true : isActive === "false" ? false : undefined,
        limit: limit ? parseInt(limit, 10) : 50,
        startAfter: startAfter || undefined,
      };

      const users = await userService.getUsers(filters);

      // Remove sensitive data and convert timestamps
      const sanitizedUsers = users.map((user) => ({
        id: user.id,
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        phoneNumber: user.phoneNumber,
        photoURL: user.photoURL,
        role: user.role,
        isActive: user.isActive,
        partnerId: user.partnerId,
        partnerName: user.partnerName,
        createdAt: convertTimestamp(user.createdAt),
        lastLogin: convertTimestamp(user.lastLogin),
      }));

      res.json({
        success: true,
        users: sanitizedUsers,
        count: sanitizedUsers.length,
      });
    } catch (error) {
      console.error("❌ Error fetching users:", error);
      res.status(500).json({
        error: "Failed to fetch users",
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/admin/users/stats
 * Get user statistics
 * Requires: Super Admin
 */
router.get(
  "/users/stats",
  verifyToken,
  requireRole(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const stats = await userService.getUserStats();
      res.json({ success: true, stats });
    } catch (error) {
      console.error("❌ Error fetching user stats:", error);
      res.status(500).json({
        error: "Failed to fetch user statistics",
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/admin/users/:uid
 * Get a specific user by UID
 * Requires: Super Admin or Support
 */
router.get(
  "/users/:uid",
  verifyToken,
  requirePermission(PERMISSIONS.VIEW_ALL_USERS),
  async (req, res) => {
    try {
      const { uid } = req.params;
      const user = await userService.getUserById(uid);

      if (!user) {
        return res.status(404).json({
          error: "User not found",
          code: "USER_NOT_FOUND",
        });
      }

      // Remove sensitive data and convert timestamps
      const sanitizedUser = {
        id: user.id,
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        phoneNumber: user.phoneNumber,
        photoURL: user.photoURL,
        role: user.role,
        permissions: user.permissions,
        isActive: user.isActive,
        partnerId: user.partnerId,
        partnerName: user.partnerName,
        createdAt: convertTimestamp(user.createdAt),
        createdBy: user.createdBy,
        lastLogin: convertTimestamp(user.lastLogin),
        preferences: user.preferences,
      };

      res.json({ success: true, user: sanitizedUser });
    } catch (error) {
      console.error("❌ Error fetching user:", error);
      res.status(500).json({
        error: "Failed to fetch user",
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/admin/users
 * Create a new user account (for translators, partners, support)
 * Requires: Super Admin
 */
router.post(
  "/users",
  verifyToken,
  requireRole(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const {
        email,
        password,
        displayName,
        role,
        partnerId,
        partnerName,
        phoneNumber,
      } = req.body;

      // Validation
      if (!email || !password || !displayName || !role) {
        return res.status(400).json({
          error: "Missing required fields",
          required: ["email", "password", "displayName", "role"],
        });
      }

      // Validate role
      if (!Object.values(ROLES).includes(role)) {
        return res.status(400).json({
          error: "Invalid role",
          validRoles: Object.values(ROLES),
        });
      }

      // Check if partner info is required for partner role
      if (role === ROLES.PARTNER && !partnerId) {
        return res.status(400).json({
          error: "Partner ID is required for partner role",
        });
      }

      // Create the user
      const newUser = await userService.createUserAccount(
        {
          email,
          password,
          displayName,
          role,
          partnerId: partnerId || null,
          partnerName: partnerName || null,
          phoneNumber: phoneNumber || null,
        },
        req.user.uid
      );

      console.log(
        `✅ Admin ${req.user.email} created user: ${email} with role: ${role}`
      );

      logActivity({
        action: "user.create",
        performedBy: req.user.uid,
        performedByEmail: req.user.email,
        targetId: newUser.id,
        targetType: "user",
        description: `Created user ${email} with role ${role}`,
        metadata: { email, role, displayName },
      });

      res.status(201).json({
        success: true,
        message: "User created successfully",
        user: {
          id: newUser.id,
          email: newUser.email,
          displayName: newUser.displayName,
          role: newUser.role,
        },
      });
    } catch (error) {
      console.error("❌ Error creating user:", error);

      // Handle Firebase Auth errors
      if (error.code === "auth/email-already-exists") {
        return res.status(409).json({
          error: "Email already exists",
          code: "EMAIL_EXISTS",
        });
      }

      if (error.code === "auth/invalid-email") {
        return res.status(400).json({
          error: "Invalid email format",
          code: "INVALID_EMAIL",
        });
      }

      if (error.code === "auth/weak-password") {
        return res.status(400).json({
          error: "Password is too weak",
          code: "WEAK_PASSWORD",
        });
      }

      res.status(500).json({
        error: "Failed to create user",
        message: error.message,
      });
    }
  }
);

/**
 * PATCH /api/admin/users/:uid/role
 * Update a user's role
 * Requires: Super Admin
 */
router.patch(
  "/users/:uid/role",
  verifyToken,
  requireRole(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { uid } = req.params;
      const { role } = req.body;

      if (!role) {
        return res.status(400).json({
          error: "Role is required",
        });
      }

      // Validate role
      if (!Object.values(ROLES).includes(role)) {
        return res.status(400).json({
          error: "Invalid role",
          validRoles: Object.values(ROLES),
        });
      }

      // Prevent changing own role (safety measure)
      if (uid === req.user.uid) {
        return res.status(400).json({
          error: "Cannot change your own role",
          code: "SELF_ROLE_CHANGE",
        });
      }

      const updatedUser = await userService.updateUserRole(
        uid,
        role,
        req.user.uid
      );

      console.log(
        `✅ Admin ${req.user.email} changed role for ${uid} to: ${role}`
      );

      logActivity({
        action: "user.roleChange",
        performedBy: req.user.uid,
        performedByEmail: req.user.email,
        targetId: uid,
        targetType: "user",
        description: `Changed role for ${updatedUser.email} to ${role}`,
        metadata: { newRole: role, email: updatedUser.email },
      });

      res.json({
        success: true,
        message: "User role updated successfully",
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          role: updatedUser.role,
        },
      });
    } catch (error) {
      console.error("❌ Error updating user role:", error);
      res.status(500).json({
        error: "Failed to update user role",
        message: error.message,
      });
    }
  }
);

/**
 * PATCH /api/admin/users/:uid/deactivate
 * Deactivate a user (soft delete)
 * Requires: Super Admin
 */
router.patch(
  "/users/:uid/deactivate",
  verifyToken,
  requireRole(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { uid } = req.params;

      // Prevent deactivating self
      if (uid === req.user.uid) {
        return res.status(400).json({
          error: "Cannot deactivate your own account",
          code: "SELF_DEACTIVATE",
        });
      }

      const updatedUser = await userService.deactivateUser(uid, req.user.uid);

      console.log(`✅ Admin ${req.user.email} deactivated user: ${uid}`);

      logActivity({
        action: "user.deactivate",
        performedBy: req.user.uid,
        performedByEmail: req.user.email,
        targetId: uid,
        targetType: "user",
        description: `Deactivated user ${updatedUser.email}`,
        metadata: { email: updatedUser.email },
      });

      res.json({
        success: true,
        message: "User deactivated successfully",
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          isActive: updatedUser.isActive,
        },
      });
    } catch (error) {
      console.error("❌ Error deactivating user:", error);
      res.status(500).json({
        error: "Failed to deactivate user",
        message: error.message,
      });
    }
  }
);

/**
 * PATCH /api/admin/users/:uid/reactivate
 * Reactivate a deactivated user
 * Requires: Super Admin
 */
router.patch(
  "/users/:uid/reactivate",
  verifyToken,
  requireRole(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { uid } = req.params;
      const updatedUser = await userService.reactivateUser(uid, req.user.uid);

      console.log(`✅ Admin ${req.user.email} reactivated user: ${uid}`);

      logActivity({
        action: "user.reactivate",
        performedBy: req.user.uid,
        performedByEmail: req.user.email,
        targetId: uid,
        targetType: "user",
        description: `Reactivated user ${updatedUser.email}`,
        metadata: { email: updatedUser.email },
      });

      res.json({
        success: true,
        message: "User reactivated successfully",
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          isActive: updatedUser.isActive,
        },
      });
    } catch (error) {
      console.error("❌ Error reactivating user:", error);
      res.status(500).json({
        error: "Failed to reactivate user",
        message: error.message,
      });
    }
  }
);

/**
 * DELETE /api/admin/users/:uid
 * Permanently delete a user and ALL related data
 * Deletes: Firebase Auth account, Firestore user doc, all documents, certified docs, bulletins
 * Requires: Super Admin
 */
router.delete(
  "/users/:uid",
  verifyToken,
  requireRole(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { uid } = req.params;
      const db = admin.firestore();

      // Prevent deleting self
      if (uid === req.user.uid) {
        return res.status(400).json({
          error: "Cannot delete your own account",
          code: "SELF_DELETE",
        });
      }

      // Fetch user info before deletion for logging
      const userDoc = await db.collection("users").doc(uid).get();
      const userData = userDoc.exists ? userDoc.data() : null;
      const userEmail = userData?.email || "unknown";

      // Delete all related data and their storage files
      const collections = ["documents", "certifiedDocuments", "bulletins"];
      const deletedCounts = {};
      let deletedFiles = 0;

      for (const col of collections) {
        const snapshot = await db
          .collection(col)
          .where("userId", "==", uid)
          .get();

        if (!snapshot.empty) {
          // Delete associated storage files
          for (const docSnap of snapshot.docs) {
            const docData = docSnap.data();
            const storagePath = docData.metadata?.storagePath || docData.storagePath;
            if (storagePath) {
              const r = await deleteFromStorage(storagePath);
              if (r.success) deletedFiles++;
            }
            const certPdfPath = docData.certification?.pdfStoragePath;
            if (certPdfPath) {
              const r = await deleteFromStorage(certPdfPath);
              if (r.success) deletedFiles++;
            }
            // Delete subcollections (revisions, versions)
            for (const sub of ["revisions", "versions"]) {
              const subSnap = await db.collection(col).doc(docSnap.id).collection(sub).get();
              if (!subSnap.empty) {
                const subBatch = db.batch();
                subSnap.docs.forEach((d) => subBatch.delete(d.ref));
                await subBatch.commit();
              }
            }
          }
          const batch = db.batch();
          snapshot.docs.forEach((doc) => batch.delete(doc.ref));
          await batch.commit();
        }
        deletedCounts[col] = snapshot.size;
      }

      // Delete revision history for documents owned by user (collectionGroup fallback)
      const revisionsSnap = await db
        .collectionGroup("revisions")
        .where("userId", "==", uid)
        .get();

      if (!revisionsSnap.empty) {
        const batch = db.batch();
        revisionsSnap.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }

      // Delete all payments and invoices for this user
      let deletedPayments = 0;
      let deletedInvoices = 0;
      try {
        const paymentsSnap = await db.collection("payments")
          .where("userId", "==", uid)
          .get();
        if (!paymentsSnap.empty) {
          const batch = db.batch();
          paymentsSnap.docs.forEach((d) => batch.delete(d.ref));
          await batch.commit();
          deletedPayments = paymentsSnap.size;
        }
        const invoicesSnap = await db.collection("invoices")
          .where("userId", "==", uid)
          .get();
        if (!invoicesSnap.empty) {
          const batch = db.batch();
          invoicesSnap.docs.forEach((d) => batch.delete(d.ref));
          await batch.commit();
          deletedInvoices = invoicesSnap.size;
        }
      } catch (payErr) {
        console.warn("⚠️ Could not delete user payments/invoices:", payErr.message);
      }

      // Delete the Firestore user document
      if (userDoc.exists) {
        await db.collection("users").doc(uid).delete();
      }

      // Delete the Firebase Auth account
      try {
        await admin.auth().deleteUser(uid);
      } catch (authError) {
        // User might not exist in Auth (orphan Firestore doc)
        console.warn(`⚠️ Could not delete Auth account for ${uid}:`, authError.message);
      }

      // Invalidate caches
      await cache.del(keys.queueStats());
      await cache.del(keys.user(uid));
      await cache.del(keys.userStats());

      logActivity({
        action: "user.delete",
        performedBy: req.user.uid,
        performedByEmail: req.user.email,
        targetId: uid,
        targetType: "user",
        description: `Permanently deleted user ${userEmail} and all related data`,
        metadata: {
          email: userEmail,
          deletedDocuments: deletedCounts,
          deletedRevisions: revisionsSnap.size,
          deletedFiles,
          deletedPayments,
          deletedInvoices,
        },
      });

      console.log(
        `✅ Admin ${req.user.email} permanently deleted user ${userEmail} (${uid}) — docs: ${JSON.stringify(deletedCounts)}, revisions: ${revisionsSnap.size}, files: ${deletedFiles}`
      );

      res.json({
        success: true,
        message: "User and all related data deleted permanently",
        deletedData: {
          user: userEmail,
          ...deletedCounts,
          revisions: revisionsSnap.size,
        },
      });
    } catch (error) {
      console.error("❌ Error deleting user:", error);
      res.status(500).json({
        error: "Failed to delete user",
        message: error.message,
      });
    }
  }
);

// ============================================
// PARTNER MANAGEMENT ROUTES
// ============================================

/**
 * GET /api/admin/partners
 * Get all partners
 * Requires: Super Admin
 */
router.get(
  "/partners",
  verifyToken,
  requireRole(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const db = admin.firestore();
      const partners = await cache.getOrSet(keys.allPartners(), TTL.PARTNER, async () => {
        const snapshot = await db
          .collection("partners")
          .orderBy("createdAt", "desc")
          .get();

        return snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
      });

      res.json({
        success: true,
        partners,
        count: partners.length,
      });
    } catch (error) {
      console.error("❌ Error fetching partners:", error);
      res.status(500).json({
        error: "Failed to fetch partners",
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/admin/partners
 * Create a new partner organization
 * Requires: Super Admin
 */
router.post(
  "/partners",
  verifyToken,
  requireRole(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const {
        name,
        shortCode,
        type,
        email,
        phone,
        address,
        commissionEnabled,
        commissionTiers,
      } = req.body;

      // Validation
      if (!name || !shortCode || !type) {
        return res.status(400).json({
          error: "Missing required fields",
          required: ["name", "shortCode", "type"],
        });
      }

      const validTypes = ["university", "highschool", "organization", "individual"];
      if (!validTypes.includes(type)) {
        return res.status(400).json({
          error: "Invalid partner type",
          validTypes,
        });
      }

      // Validate commission tiers if enabled
      if (commissionEnabled && commissionTiers) {
        for (const tier of commissionTiers) {
          if (typeof tier.minStudents !== "number" || tier.minStudents < 1) {
            return res.status(400).json({
              error:
                "Invalid commission tier: minStudents must be a positive number",
            });
          }
          if (
            tier.maxStudents !== null &&
            typeof tier.maxStudents !== "number"
          ) {
            return res.status(400).json({
              error:
                "Invalid commission tier: maxStudents must be a number or null",
            });
          }
          if (
            typeof tier.percentage !== "number" ||
            tier.percentage < 0 ||
            tier.percentage > 100
          ) {
            return res.status(400).json({
              error:
                "Invalid commission tier: percentage must be between 0 and 100",
            });
          }
        }
      }

      const db = admin.firestore();
      const partnerId = `partner_${Date.now()}`;

      const partnerData = {
        partnerId,
        name,
        shortCode: shortCode.toUpperCase(),
        type,
        email: email || null,
        phone: phone || null,
        address: address || null,
        adminUsers: [],
        logo: null,
        primaryColor: "#003366",
        stats: {
          totalStudents: 0,
          documentsThisMonth: 0,
          documentsTotal: 0,
        },
        pricing: {
          discountPercent: 0,
          bulkRates: false,
        },
        // Commission settings
        commissionEnabled: commissionEnabled || false,
        commissionTiers:
          commissionEnabled && commissionTiers
            ? commissionTiers
            : [
                { minStudents: 1, maxStudents: 100, percentage: 10 },
                { minStudents: 101, maxStudents: null, percentage: 15 },
              ],
        isActive: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: req.user.uid,
      };

      await db.collection("partners").doc(partnerId).set(partnerData);

      console.log(
        `✅ Admin ${req.user.email} created partner: ${name}${
          commissionEnabled
            ? ` (commission enabled: ${commissionTiers?.length || 2} tiers)`
            : ""
        }`
      );

      logActivity({
        action: "partner.create",
        performedBy: req.user.uid,
        performedByEmail: req.user.email,
        targetId: partnerId,
        targetType: "partner",
        description: `Created partner ${name} (${type})`,
        metadata: { name, shortCode, type },
      });

      res.status(201).json({
        success: true,
        message: "Partner created successfully",
        partner: {
          id: partnerId,
          name,
          shortCode: shortCode.toUpperCase(),
          type,
          commissionEnabled: commissionEnabled || false,
        },
      });
    } catch (error) {
      console.error("❌ Error creating partner:", error);
      res.status(500).json({
        error: "Failed to create partner",
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/admin/partners/:partnerId
 * Get a specific partner
 * Requires: Super Admin or Partner role (own partner only)
 */
router.get(
  "/partners/:partnerId",
  verifyToken,
  requirePermission([
    PERMISSIONS.VIEW_ALL_PARTNERS,
    PERMISSIONS.VIEW_PARTNER_ANALYTICS,
  ]),
  async (req, res) => {
    try {
      const { partnerId } = req.params;

      // For partner role, check they can only access their own partner
      if (req.user.role === ROLES.PARTNER && req.user.partnerId !== partnerId) {
        return res.status(403).json({
          error: "Access denied",
          message: "You can only view your own organization",
        });
      }

      const db = admin.firestore();
      const partner = await cache.getOrSet(keys.partner(partnerId), TTL.PARTNER, async () => {
        const partnerDoc = await db.collection("partners").doc(partnerId).get();
        if (!partnerDoc.exists) return null;
        return { id: partnerDoc.id, ...partnerDoc.data() };
      });

      if (!partner) {
        return res.status(404).json({
          error: "Partner not found",
          code: "PARTNER_NOT_FOUND",
        });
      }

      res.json({
        success: true,
        partner,
      });
    } catch (error) {
      console.error("❌ Error fetching partner:", error);
      res.status(500).json({
        error: "Failed to fetch partner",
        message: error.message,
      });
    }
  }
);

/**
 * PATCH /api/admin/partners/:partnerId
 * Update a partner
 * Requires: Super Admin
 */
router.patch(
  "/partners/:partnerId",
  verifyToken,
  requireRole(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { partnerId } = req.params;
      const updates = req.body;

      // Prevent updating certain fields
      delete updates.partnerId;
      delete updates.createdAt;
      delete updates.createdBy;

      // Validate commission tiers if being updated
      if (updates.commissionEnabled && updates.commissionTiers) {
        for (const tier of updates.commissionTiers) {
          if (typeof tier.minStudents !== "number" || tier.minStudents < 1) {
            return res.status(400).json({
              error:
                "Invalid commission tier: minStudents must be a positive number",
            });
          }
          if (
            tier.maxStudents !== null &&
            typeof tier.maxStudents !== "number"
          ) {
            return res.status(400).json({
              error:
                "Invalid commission tier: maxStudents must be a number or null",
            });
          }
          if (
            typeof tier.percentage !== "number" ||
            tier.percentage < 0 ||
            tier.percentage > 100
          ) {
            return res.status(400).json({
              error:
                "Invalid commission tier: percentage must be between 0 and 100",
            });
          }
        }
      }

      const db = admin.firestore();
      const partnerRef = db.collection("partners").doc(partnerId);

      const partnerDoc = await partnerRef.get();
      if (!partnerDoc.exists) {
        return res.status(404).json({
          error: "Partner not found",
        });
      }

      await partnerRef.update({
        ...updates,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: req.user.uid,
      });

      const updated = await partnerRef.get();

      console.log(`✅ Admin ${req.user.email} updated partner: ${partnerId}`);

      logActivity({
        action: "partner.update",
        performedBy: req.user.uid,
        performedByEmail: req.user.email,
        targetId: partnerId,
        targetType: "partner",
        description: `Updated partner ${partnerId}`,
        metadata: { updatedFields: Object.keys(updates) },
      });

      // Invalidate partner caches
      await cache.del(keys.partner(partnerId));
      await cache.del(keys.allPartners());

      res.json({
        success: true,
        message: "Partner updated successfully",
        partner: { id: updated.id, ...updated.data() },
      });
    } catch (error) {
      console.error("❌ Error updating partner:", error);
      res.status(500).json({
        error: "Failed to update partner",
        message: error.message,
      });
    }
  }
);

// ============================================
// SYSTEM ANALYTICS ROUTES
// ============================================

/**
 * GET /api/admin/analytics/overview
 * Get system overview analytics
 * Requires: Super Admin
 */
router.get(
  "/analytics/overview",
  verifyToken,
  requireRole(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const analytics = await cache.getOrSet(keys.adminAnalytics(), TTL.ANALYTICS, async () => {
        const db = admin.firestore();

        // Get user stats
        const userStats = await userService.getUserStats();

        // Get document stats
        const bulletinsSnapshot = await db.collection("bulletins").get();
        const documentStats = {
          total: bulletinsSnapshot.size,
          byStatus: {},
          byFormType: {},
        };

        bulletinsSnapshot.forEach((doc) => {
          const data = doc.data();
          const status = data.workflow?.status || "unknown";
          const formType = data.metadata?.formType || "unknown";

          documentStats.byStatus[status] =
            (documentStats.byStatus[status] || 0) + 1;
          documentStats.byFormType[formType] =
            (documentStats.byFormType[formType] || 0) + 1;
        });

        // Get partner stats
        const partnersSnapshot = await db.collection("partners").get();
        const partnerStats = {
          total: partnersSnapshot.size,
          active: 0,
        };

        partnersSnapshot.forEach((doc) => {
          if (doc.data().isActive !== false) {
            partnerStats.active++;
          }
        });

        return {
          users: userStats,
          documents: documentStats,
          partners: partnerStats,
          generatedAt: new Date().toISOString(),
        };
      });

      res.json({
        success: true,
        analytics,
      });
    } catch (error) {
      console.error("❌ Error fetching analytics:", error);
      res.status(500).json({
        error: "Failed to fetch analytics",
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/admin/roles
 * Get available roles and permissions (for UI)
 * Requires: Super Admin
 */
router.get(
  "/roles",
  verifyToken,
  requireRole(ROLES.SUPER_ADMIN),
  async (req, res) => {
    res.json({
      success: true,
      roles: Object.values(ROLES),
      permissions: Object.values(PERMISSIONS),
    });
  }
);

// ============================================
// ACTIVITY LOGS ROUTES
// ============================================

/**
 * GET /api/admin/logs
 * Get activity logs with optional filters
 * Requires: Super Admin
 */
router.get(
  "/logs",
  verifyToken,
  requireRole(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { action, performedBy, targetType, limit, startAfter } = req.query;

      const logs = await getLogs({
        action: action || undefined,
        performedBy: performedBy || undefined,
        targetType: targetType || undefined,
        limit: limit ? parseInt(limit, 10) : 50,
        startAfter: startAfter || undefined,
      });

      res.json({
        success: true,
        logs,
        count: logs.length,
      });
    } catch (error) {
      console.error("❌ Error fetching logs:", error);
      res.status(500).json({
        error: "Failed to fetch activity logs",
        message: error.message,
      });
    }
  }
);

// ============================================
// SYSTEM SETTINGS ROUTES
// ============================================

const SETTINGS_DOC = "systemSettings";
const SETTINGS_COLLECTION = "system";

/**
 * GET /api/admin/settings
 * Get system settings
 * Requires: Super Admin
 */
router.get(
  "/settings",
  verifyToken,
  requireRole(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const db = admin.firestore();
      const doc = await db
        .collection(SETTINGS_COLLECTION)
        .doc(SETTINGS_DOC)
        .get();

      const defaults = {
        pricePerDocument: 30,
        currency: "USD",
        aiProvider: "openai",
        aiModel: "gpt-4o",
        maxFileSize: 10, // MB
        allowedFileTypes: ["image/jpeg", "image/png", "application/pdf"],
        maintenanceMode: false,
        emailNotifications: true,
      };

      const settings = doc.exists ? { ...defaults, ...doc.data() } : defaults;

      res.json({ success: true, settings });
    } catch (error) {
      console.error("❌ Error fetching settings:", error);
      res.status(500).json({
        error: "Failed to fetch settings",
        message: error.message,
      });
    }
  }
);

/**
 * PATCH /api/admin/settings
 * Update system settings
 * Requires: Super Admin
 */
router.patch(
  "/settings",
  verifyToken,
  requireRole(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const updates = req.body;

      // Validate specific fields
      if (
        updates.pricePerDocument !== undefined &&
        (typeof updates.pricePerDocument !== "number" ||
          updates.pricePerDocument < 0)
      ) {
        return res.status(400).json({
          error: "pricePerDocument must be a non-negative number",
        });
      }

      if (
        updates.aiProvider !== undefined &&
        !["openai", "anthropic"].includes(updates.aiProvider)
      ) {
        return res.status(400).json({
          error: "aiProvider must be 'openai' or 'anthropic'",
        });
      }

      if (
        updates.maxFileSize !== undefined &&
        (typeof updates.maxFileSize !== "number" || updates.maxFileSize < 1)
      ) {
        return res.status(400).json({
          error: "maxFileSize must be at least 1 MB",
        });
      }

      const db = admin.firestore();
      await db
        .collection(SETTINGS_COLLECTION)
        .doc(SETTINGS_DOC)
        .set(
          {
            ...updates,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: req.user.uid,
          },
          { merge: true }
        );

      const updatedDoc = await db
        .collection(SETTINGS_COLLECTION)
        .doc(SETTINGS_DOC)
        .get();

      logActivity({
        action: "settings.update",
        performedBy: req.user.uid,
        performedByEmail: req.user.email,
        targetType: "system",
        description: `Updated system settings: ${Object.keys(updates).join(", ")}`,
        metadata: { updatedFields: Object.keys(updates) },
      });

      res.json({
        success: true,
        message: "Settings updated successfully",
        settings: updatedDoc.data(),
      });
    } catch (error) {
      console.error("❌ Error updating settings:", error);
      res.status(500).json({
        error: "Failed to update settings",
        message: error.message,
      });
    }
  }
);

// ============================================
// PAYMENT SETTINGS ROUTES
// ============================================

/**
 * GET /api/admin/payment-settings
 * Get payment configuration (Stripe keys masked, pricing, enabled status)
 * Requires: Super Admin
 */
router.get(
  "/payment-settings",
  verifyToken,
  requireRole(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const db = admin.firestore();
      const doc = await db
        .collection(SETTINGS_COLLECTION)
        .doc(SETTINGS_DOC)
        .get();

      const data = doc.exists ? doc.data() : {};

      // Mask secret keys — only show last 8 chars
      const maskKey = (key) => {
        if (!key) return "";
        if (key.length <= 12) return "••••••••";
        return "••••••••" + key.slice(-8);
      };

      const paymentSettings = {
        stripeSecretKey: maskKey(data.stripeSecretKey),
        stripePublishableKey: data.stripePublishableKey || "",
        stripeWebhookSecret: maskKey(data.stripeWebhookSecret),
        paymentsEnabled: data.paymentsEnabled !== false,
        pricing: data.pricing || {
          standard: { amount: 3000, currency: "usd", label: "Standard (Up to 24 hrs)" },
          rush: { amount: 3500, currency: "usd", label: "Rush (Up to 12 hrs)" },
          express: { amount: 4500, currency: "usd", label: "Express (1–5 hrs)" },
        },
        hasSecretKey: !!(data.stripeSecretKey || process.env.STRIPE_SECRET_KEY),
        hasPublishableKey: !!(data.stripePublishableKey || process.env.VITE_STRIPE_PUBLISHABLE_KEY),
        hasWebhookSecret: !!(data.stripeWebhookSecret || process.env.STRIPE_WEBHOOK_SECRET),
      };

      res.json({ success: true, paymentSettings });
    } catch (error) {
      console.error("❌ Error fetching payment settings:", error);
      res.status(500).json({
        error: "Failed to fetch payment settings",
        message: error.message,
      });
    }
  }
);

/**
 * PATCH /api/admin/payment-settings
 * Update payment configuration (Stripe keys, pricing, enabled status)
 * Requires: Super Admin
 */
router.patch(
  "/payment-settings",
  verifyToken,
  requireRole(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const {
        stripeSecretKey,
        stripePublishableKey,
        stripeWebhookSecret,
        paymentsEnabled,
        pricing,
      } = req.body;

      const updates = {};

      // Validate and set Stripe keys (only update if new value provided, not masked)
      if (stripeSecretKey && !stripeSecretKey.startsWith("••")) {
        if (!stripeSecretKey.startsWith("sk_")) {
          return res.status(400).json({
            error: "Invalid Stripe Secret Key. It should start with 'sk_test_' or 'sk_live_'",
          });
        }
        updates.stripeSecretKey = stripeSecretKey;
      }

      if (stripePublishableKey !== undefined) {
        if (stripePublishableKey && !stripePublishableKey.startsWith("pk_")) {
          return res.status(400).json({
            error: "Invalid Stripe Publishable Key. It should start with 'pk_test_' or 'pk_live_'",
          });
        }
        updates.stripePublishableKey = stripePublishableKey;
      }

      if (stripeWebhookSecret && !stripeWebhookSecret.startsWith("••")) {
        if (!stripeWebhookSecret.startsWith("whsec_")) {
          return res.status(400).json({
            error: "Invalid Stripe Webhook Secret. It should start with 'whsec_'",
          });
        }
        updates.stripeWebhookSecret = stripeWebhookSecret;
      }

      if (paymentsEnabled !== undefined) {
        updates.paymentsEnabled = !!paymentsEnabled;
      }

      // Validate pricing
      if (pricing) {
        const tiers = ["standard", "rush", "express"];
        for (const tier of tiers) {
          if (pricing[tier]) {
            if (typeof pricing[tier].amount !== "number" || pricing[tier].amount < 0) {
              return res.status(400).json({
                error: `Invalid amount for ${tier} tier. Must be a non-negative number (in cents).`,
              });
            }
          }
        }
        updates.pricing = pricing;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      const db = admin.firestore();
      await db
        .collection(SETTINGS_COLLECTION)
        .doc(SETTINGS_DOC)
        .set(
          {
            ...updates,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: req.user.uid,
          },
          { merge: true }
        );

      // Invalidate payment settings cache
      await cache.invalidatePrefix("paymentSettings");

      logActivity({
        action: "payment_settings.update",
        performedBy: req.user.uid,
        performedByEmail: req.user.email,
        targetType: "system",
        description: `Updated payment settings: ${Object.keys(updates).join(", ")}`,
        metadata: {
          updatedFields: Object.keys(updates),
          paymentsEnabled: updates.paymentsEnabled,
        },
      });

      res.json({
        success: true,
        message: "Payment settings updated successfully",
      });
    } catch (error) {
      console.error("❌ Error updating payment settings:", error);
      res.status(500).json({
        error: "Failed to update payment settings",
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/admin/payment-settings/test
 * Test Stripe connection with the configured keys
 * Requires: Super Admin
 */
router.post(
  "/payment-settings/test",
  verifyToken,
  requireRole(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const paymentService = require("../services/paymentService");
      const stripe = await paymentService.getStripe();

      // Lightweight API call to verify the key works
      const account = await stripe.accounts.retrieve();

      res.json({
        success: true,
        message: "Stripe connection successful",
        account: {
          id: account.id,
          country: account.country,
          defaultCurrency: account.default_currency,
          chargesEnabled: account.charges_enabled,
          payoutsEnabled: account.payouts_enabled,
        },
      });
    } catch (error) {
      console.error("❌ Stripe connection test failed:", error.message);
      res.status(400).json({
        success: false,
        error: "Stripe connection failed",
        message: error.message,
      });
    }
  }
);

// ============================================
// DOCUMENT MANAGEMENT ROUTES
// ============================================

/**
 * GET /api/admin/documents
 * Get all documents with filters
 * Requires: Super Admin
 */
router.get(
  "/documents",
  verifyToken,
  requireRole(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { status, formType, userId, limit: limitParam, startAfter } = req.query;
      const db = admin.firestore();

      let query = db.collection("bulletins").orderBy("metadata.uploadedAt", "desc");

      if (userId) {
        query = query.where("userId", "==", userId);
      }

      const limitVal = Math.min(parseInt(limitParam, 10) || 50, 200);
      query = query.limit(limitVal);

      if (startAfter) {
        const startDoc = await db.collection("bulletins").doc(startAfter).get();
        if (startDoc.exists) {
          query = query.startAfter(startDoc);
        }
      }

      const snapshot = await query.get();

      let documents = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          studentName: data.metadata?.studentName || "Unknown",
          formType: data.metadata?.formType || "unknown",
          status: data.workflow?.status || "unknown",
          userId: data.userId || null,
          userEmail: data.userEmail || null,
          uploadedAt: data.metadata?.uploadedAt?.toDate?.()
            ? data.metadata.uploadedAt.toDate().toISOString()
            : data.metadata?.createdAt || null,
          certificationId: data.metadata?.certificationId || null,
          isCertified: data.metadata?.isCertified || false,
        };
      });

      // Client-side filter for status/formType (Firestore composite index limitations)
      if (status) {
        documents = documents.filter((d) => d.status === status);
      }
      if (formType) {
        documents = documents.filter((d) => d.formType === formType);
      }

      res.json({
        success: true,
        documents,
        count: documents.length,
      });
    } catch (error) {
      console.error("❌ Error fetching documents:", error);
      res.status(500).json({
        error: "Failed to fetch documents",
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/admin/documents/:id
 * Get a specific document with full details
 * Requires: Super Admin
 */
router.get(
  "/documents/:id",
  verifyToken,
  requireRole(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { id } = req.params;
      const db = admin.firestore();
      const doc = await db.collection("bulletins").doc(id).get();

      if (!doc.exists) {
        return res.status(404).json({
          error: "Document not found",
          code: "DOCUMENT_NOT_FOUND",
        });
      }

      const data = doc.data();
      res.json({
        success: true,
        document: {
          id: doc.id,
          ...data,
          metadata: {
            ...data.metadata,
            uploadedAt: data.metadata?.uploadedAt?.toDate?.()
              ? data.metadata.uploadedAt.toDate().toISOString()
              : data.metadata?.uploadedAt,
          },
        },
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
 * DELETE /api/admin/documents/:id
 * Delete a document
 * Requires: Super Admin
 */
router.delete(
  "/documents/:id",
  verifyToken,
  requireRole(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { id } = req.params;
      const db = admin.firestore();

      // Check all three collections: documents, certifiedDocuments, bulletins
      const collections = ["documents", "certifiedDocuments", "bulletins"];
      let doc = null;
      let collection = null;

      for (const col of collections) {
        const snap = await db.collection(col).doc(id).get();
        if (snap.exists) {
          doc = snap;
          collection = col;
          break;
        }
      }

      if (!doc) {
        return res.status(404).json({
          error: "Document not found",
        });
      }

      const data = doc.data();

      // 1. Delete files from Firebase Storage
      const deletedFiles = [];

      // Original uploaded file
      const storagePath = data.metadata?.storagePath || data.storagePath;
      if (storagePath) {
        const result = await deleteFromStorage(storagePath);
        if (result.success) deletedFiles.push(storagePath);
      }

      // Certified PDF (certifiedDocuments collection)
      const certPdfPath = data.certification?.pdfStoragePath;
      if (certPdfPath) {
        const result = await deleteFromStorage(certPdfPath);
        if (result.success) deletedFiles.push(certPdfPath);
      }

      // 2. Delete subcollections (revisions, versions)
      const subcollections = ["revisions", "versions"];
      let deletedSubdocs = 0;
      for (const sub of subcollections) {
        const subSnap = await db
          .collection(collection)
          .doc(id)
          .collection(sub)
          .get();
        if (!subSnap.empty) {
          const batch = db.batch();
          subSnap.docs.forEach((d) => batch.delete(d.ref));
          await batch.commit();
          deletedSubdocs += subSnap.size;
        }
      }

      // 3. Delete the Firestore document itself
      await db.collection(collection).doc(id).delete();

      // 4. Delete related payments and invoices (for certifiedDocuments)
      let deletedPayments = 0;
      let deletedInvoices = 0;
      try {
        const paymentsSnap = await db.collection("payments")
          .where("certDocId", "==", id)
          .get();
        for (const payDoc of paymentsSnap.docs) {
          await payDoc.ref.delete();
          deletedPayments++;
        }
        const invoicesSnap = await db.collection("invoices")
          .where("certDocId", "==", id)
          .get();
        for (const invDoc of invoicesSnap.docs) {
          await invDoc.ref.delete();
          deletedInvoices++;
        }
      } catch (payErr) {
        console.warn("⚠️ Could not delete related payments/invoices:", payErr.message);
      }

      const studentName =
        data.studentName ||
        data.documentTitle ||
        data.metadata?.studentName ||
        data.originalData?.academicInfo?.studentName ||
        "unknown";

      logActivity({
        action: "document.delete",
        performedBy: req.user.uid,
        performedByEmail: req.user.email,
        targetId: id,
        targetType: "document",
        description: `Deleted document for ${studentName} from ${collection}`,
        metadata: {
          studentName,
          formType: collection === "certifiedDocuments" ? data.formType : data.metadata?.formType,
          userId: data.userId,
          collection,
          deletedFiles,
          deletedSubdocs,
          deletedPayments,
          deletedInvoices,
        },
      });

      console.log(
        `✅ Admin ${req.user.email} deleted document: ${id} from ${collection} — files: ${deletedFiles.length}, subdocs: ${deletedSubdocs}`
      );

      // Invalidate cached queue stats so counts refresh immediately
      await cache.del(keys.queueStats());

      res.json({
        success: true,
        message: "Document and all related data deleted successfully",
        deletedData: {
          collection,
          files: deletedFiles.length,
          subdocuments: deletedSubdocs,
        },
      });
    } catch (error) {
      console.error("❌ Error deleting document:", error);
      res.status(500).json({
        error: "Failed to delete document",
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/admin/users/search
 * Search users by email or display name
 * Requires: Super Admin
 */
router.get(
  "/users/search",
  verifyToken,
  requireRole(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { q } = req.query;

      if (!q || q.length < 2) {
        return res.status(400).json({
          error: "Search query must be at least 2 characters",
        });
      }

      const db = admin.firestore();
      const searchLower = q.toLowerCase();

      // Search by email prefix
      const emailSnapshot = await db
        .collection("users")
        .where("email", ">=", searchLower)
        .where("email", "<=", searchLower + "\uf8ff")
        .limit(20)
        .get();

      // Search by displayName prefix
      const nameSnapshot = await db
        .collection("users")
        .where("displayName", ">=", q)
        .where("displayName", "<=", q + "\uf8ff")
        .limit(20)
        .get();

      // Merge and deduplicate
      const usersMap = new Map();
      const processDoc = (doc) => {
        if (!usersMap.has(doc.id)) {
          const data = doc.data();
          usersMap.set(doc.id, {
            id: doc.id,
            uid: data.uid,
            email: data.email,
            displayName: data.displayName,
            role: data.role,
            isActive: data.isActive,
            createdAt: convertTimestamp(data.createdAt),
          });
        }
      };

      emailSnapshot.forEach(processDoc);
      nameSnapshot.forEach(processDoc);

      res.json({
        success: true,
        users: Array.from(usersMap.values()),
        count: usersMap.size,
      });
    } catch (error) {
      console.error("❌ Error searching users:", error);
      res.status(500).json({
        error: "Failed to search users",
        message: error.message,
      });
    }
  }
);

// ============================================
// TRANSLATOR MANAGEMENT ROUTES
// ============================================

/**
 * GET /api/admin/translators
 * List all translators with their document stats
 */
router.get(
  "/translators",
  verifyToken,
  requireRole([ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const db = admin.firestore();

      // Get all users with translator role
      const usersSnap = await db
        .collection("users")
        .where("role", "==", "translator")
        .get();

      const translators = [];
      for (const doc of usersSnap.docs) {
        const data = doc.data();

        // Count assigned (in_review) documents across both collections
        const [docsAssigned, certDocsAssigned, docsApproved, certDocsApproved] =
          await Promise.all([
            db
              .collection("documents")
              .where("assignedTo", "==", doc.id)
              .where("status", "==", "in_review")
              .get(),
            db
              .collection("certifiedDocuments")
              .where("assignment.assignedTo", "==", doc.id)
              .where("status", "==", "in_review")
              .get(),
            db
              .collection("documents")
              .where("assignedTo", "==", doc.id)
              .where("status", "==", "approved")
              .get(),
            db
              .collection("certifiedDocuments")
              .where("assignment.assignedTo", "==", doc.id)
              .where("status", "==", "certified")
              .get(),
          ]);

        translators.push({
          uid: doc.id,
          email: data.email,
          displayName: data.displayName || data.name || null,
          photoURL: data.photoURL || null,
          isActive: data.isActive !== false,
          role: data.role,
          createdAt: convertTimestamp(data.createdAt),
          assignedCount: docsAssigned.size + certDocsAssigned.size,
          approvedCount: docsApproved.size + certDocsApproved.size,
        });
      }

      res.json({ success: true, translators });
    } catch (error) {
      console.error("❌ Error fetching translators:", error);
      res
        .status(500)
        .json({ error: "Failed to fetch translators", message: error.message });
    }
  }
);

/**
 * GET /api/admin/translators/:uid/documents
 * Get all documents assigned to a specific translator
 */
router.get(
  "/translators/:uid/documents",
  verifyToken,
  requireRole([ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { uid } = req.params;
      const db = admin.firestore();

      const [docsSnap, certDocsSnap] = await Promise.all([
        db
          .collection("documents")
          .where("assignedTo", "==", uid)
          .orderBy("updatedAt", "desc")
          .limit(50)
          .get(),
        db
          .collection("certifiedDocuments")
          .where("assignment.assignedTo", "==", uid)
          .orderBy("updatedAt", "desc")
          .limit(50)
          .get(),
      ]);

      const documents = [];
      docsSnap.forEach((doc) => {
        const d = doc.data();
        documents.push({
          id: doc.id,
          studentName: d.studentName || d.extractedData?.studentName,
          formType: d.formType,
          status: d.status,
          source: "documents",
          assignedAt: convertTimestamp(d.assignedAt),
          createdAt: convertTimestamp(d.createdAt),
        });
      });
      certDocsSnap.forEach((doc) => {
        const d = doc.data();
        documents.push({
          id: doc.id,
          studentName:
            d.originalData?.academicInfo?.studentName ||
            d.originalData?.studentName,
          formType: d.formType,
          status: d.status,
          source: "certifiedDocuments",
          assignedAt: convertTimestamp(d.assignment?.claimedAt),
          createdAt: convertTimestamp(d.createdAt),
        });
      });

      res.json({ success: true, documents });
    } catch (error) {
      console.error("❌ Error fetching translator documents:", error);
      res.status(500).json({
        error: "Failed to fetch translator documents",
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/admin/documents/:id/assign
 * Assign a document to a translator (super admin only)
 */
router.post(
  "/documents/:id/assign",
  verifyToken,
  requireRole([ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { translatorUid } = req.body;

      if (!translatorUid) {
        return res.status(400).json({ error: "translatorUid is required" });
      }

      const db = admin.firestore();

      // Verify translator exists and has translator role
      const translatorDoc = await db.collection("users").doc(translatorUid).get();
      if (!translatorDoc.exists || translatorDoc.data().role !== "translator") {
        return res.status(400).json({ error: "Invalid translator" });
      }

      const translatorData = translatorDoc.data();
      const translatorName =
        translatorData.displayName || translatorData.name || translatorData.email;

      // Try documents collection first
      let docRef = db.collection("documents").doc(id);
      let docSnap = await docRef.get();
      let source = "documents";

      if (!docSnap.exists) {
        docRef = db.collection("certifiedDocuments").doc(id);
        docSnap = await docRef.get();
        source = "certifiedDocuments";
      }

      if (!docSnap.exists) {
        return res.status(404).json({ error: "Document not found" });
      }

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

      await logActivity({
        action: "document.assign",
        performedBy: req.user.uid,
        targetId: id,
        targetType: "document",
        description: `Assigned document to ${translatorName}`,
        metadata: { translatorUid, source },
      });

      // Invalidate caches
      await cache.del(keys.doc(id));
      await cache.del(keys.certDoc(id));
      await cache.invalidatePrefix("queue:");

      // Notify the document owner that their document is being worked on
      const docData = docSnap.data();
      notifications.onDocumentClaimed(
        { userId: docData.userId, id, formType: docData.formType },
        translatorUid
      ).catch((err) => console.error("🚨 Assignment notification failed:", err.message));

      res.json({ success: true, message: "Document assigned successfully" });
    } catch (error) {
      console.error("❌ Error assigning document:", error);
      res
        .status(500)
        .json({ error: "Failed to assign document", message: error.message });
    }
  }
);

/**
 * POST /api/admin/documents/:id/unassign
 * Remove assignment and put document back in queue (super admin only)
 */
router.post(
  "/documents/:id/unassign",
  verifyToken,
  requireRole([ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const db = admin.firestore();

      // Try documents collection first
      let docRef = db.collection("documents").doc(id);
      let docSnap = await docRef.get();
      let source = "documents";

      if (!docSnap.exists) {
        docRef = db.collection("certifiedDocuments").doc(id);
        docSnap = await docRef.get();
        source = "certifiedDocuments";
      }

      if (!docSnap.exists) {
        return res.status(404).json({ error: "Document not found" });
      }

      const data = docSnap.data();
      const previousAssignee =
        source === "certifiedDocuments"
          ? data.assignment?.assignedTo
          : data.assignedTo;

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
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      await logActivity({
        action: "document.unassign",
        performedBy: req.user.uid,
        targetId: id,
        targetType: "document",
        description: `Unassigned document and returned to queue`,
        metadata: { previousAssignee, source },
      });

      await cache.del(keys.doc(id));
      await cache.del(keys.certDoc(id));
      await cache.invalidatePrefix("queue:");

      res.json({
        success: true,
        message: "Document unassigned and returned to queue",
      });
    } catch (error) {
      console.error("❌ Error unassigning document:", error);
      res.status(500).json({
        error: "Failed to unassign document",
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/admin/queue
 * Get all documents in the translation queue (for admin view)
 */
router.get(
  "/queue",
  verifyToken,
  requireRole([ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { status, limit = 50 } = req.query;
      const db = admin.firestore();

      const validStatuses = status
        ? [status]
        : ["pending_review", "in_review", "ai_completed"];

      const [docsSnap, certSnap] = await Promise.all([
        db
          .collection("documents")
          .where("status", "in", validStatuses)
          .orderBy("createdAt", "asc")
          .limit(parseInt(limit, 10))
          .get(),
        db
          .collection("certifiedDocuments")
          .where("status", "in", validStatuses)
          .where("isActive", "==", true)
          .orderBy("createdAt", "asc")
          .limit(parseInt(limit, 10))
          .get(),
      ]);

      const documents = [];
      docsSnap.forEach((doc) => {
        const d = doc.data();
        documents.push({
          id: doc.id,
          studentName: d.studentName || d.extractedData?.studentName,
          formType: d.formType,
          status: d.status,
          assignedTo: d.assignedTo,
          assignedToName: d.assignedToName,
          userEmail: d.userEmail,
          source: "documents",
          createdAt: convertTimestamp(d.createdAt),
        });
      });
      certSnap.forEach((doc) => {
        const d = doc.data();
        documents.push({
          id: doc.id,
          studentName:
            d.originalData?.academicInfo?.studentName ||
            d.originalData?.studentName,
          formType: d.formType,
          status: d.status,
          assignedTo: d.assignment?.assignedTo,
          assignedToName: null,
          userEmail: d.userEmail,
          source: "certifiedDocuments",
          createdAt: convertTimestamp(d.createdAt),
        });
      });

      documents.sort((a, b) => {
        const aTime = new Date(a.createdAt || 0).getTime();
        const bTime = new Date(b.createdAt || 0).getTime();
        return aTime - bTime;
      });

      res.json({
        success: true,
        documents: documents.slice(0, parseInt(limit, 10)),
        count: documents.length,
      });
    } catch (error) {
      console.error("❌ Error fetching admin queue:", error);
      res
        .status(500)
        .json({ error: "Failed to fetch queue", message: error.message });
    }
  }
);

// ============================================
// PROMO CODE MANAGEMENT ROUTES
// ============================================

/**
 * GET /api/admin/promo-codes
 * List all promo codes with optional filters
 * Requires: Super Admin
 */
router.get(
  "/promo-codes",
  verifyToken,
  requireRole(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { partnerId, isActive, type } = req.query;
      const db = admin.firestore();

      let query = db.collection("promoCodes").orderBy("createdAt", "desc");

      if (partnerId) {
        query = query.where("partnerId", "==", partnerId);
      }
      if (isActive !== undefined) {
        query = query.where("isActive", "==", isActive === "true");
      }

      const snapshot = await query.get();
      let codes = [];

      snapshot.forEach((doc) => {
        const data = doc.data();
        if (type && data.type !== type) return;
        codes.push({
          id: doc.id,
          ...data,
          createdAt: convertTimestamp(data.createdAt),
          updatedAt: convertTimestamp(data.updatedAt),
          validFrom: convertTimestamp(data.validFrom),
          validUntil: convertTimestamp(data.validUntil),
        });
      });

      res.json({
        success: true,
        promoCodes: codes,
        count: codes.length,
      });
    } catch (error) {
      console.error("❌ Error fetching promo codes:", error);
      res.status(500).json({
        error: "Failed to fetch promo codes",
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/admin/promo-codes
 * Create a new promo code
 * Requires: Super Admin
 */
router.post(
  "/promo-codes",
  verifyToken,
  requireRole(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const {
        code,
        partnerId,
        type,
        value,
        maxUses,
        validFrom,
        validUntil,
        applicableTo,
        description,
      } = req.body;

      // Validation
      if (!code || !partnerId || !type || value === undefined) {
        return res.status(400).json({
          error: "Missing required fields",
          required: ["code", "partnerId", "type", "value"],
        });
      }

      const validTypes = ["percentage", "flat"];
      if (!validTypes.includes(type)) {
        return res.status(400).json({
          error: "Invalid promo code type",
          validTypes,
        });
      }

      if (typeof value !== "number" || value < 0) {
        return res.status(400).json({
          error: "Value must be a non-negative number",
        });
      }

      if (type === "percentage" && value > 100) {
        return res.status(400).json({
          error: "Percentage value cannot exceed 100",
        });
      }

      const sanitizedCode = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (sanitizedCode.length < 3 || sanitizedCode.length > 20) {
        return res.status(400).json({
          error: "Code must be between 3 and 20 alphanumeric characters",
        });
      }

      const db = admin.firestore();

      // Verify partner exists
      const partnerDoc = await db.collection("partners").doc(partnerId).get();
      if (!partnerDoc.exists) {
        return res.status(404).json({
          error: "Partner not found",
        });
      }

      // Check for duplicate code
      const existingCode = await db
        .collection("promoCodes")
        .where("code", "==", sanitizedCode)
        .limit(1)
        .get();

      if (!existingCode.empty) {
        return res.status(409).json({
          error: "A promo code with this code already exists",
        });
      }

      const promoCodeData = {
        code: sanitizedCode,
        partnerId,
        partnerName: partnerDoc.data().name,
        type,
        value,
        maxUses: maxUses ? parseInt(maxUses, 10) : null,
        currentUses: 0,
        validFrom: validFrom
          ? admin.firestore.Timestamp.fromDate(new Date(validFrom))
          : null,
        validUntil: validUntil
          ? admin.firestore.Timestamp.fromDate(new Date(validUntil))
          : null,
        applicableTo: applicableTo || ["all"],
        description: description || null,
        isActive: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: req.user.uid,
      };

      const docRef = await db.collection("promoCodes").add(promoCodeData);

      console.log(
        `✅ Admin ${req.user.email} created promo code: ${sanitizedCode} for partner ${partnerDoc.data().name}`
      );

      logActivity({
        action: "promo_code.create",
        performedBy: req.user.uid,
        performedByEmail: req.user.email,
        targetId: docRef.id,
        targetType: "promo_code",
        description: `Created promo code ${sanitizedCode} (${type}: ${value}${type === "percentage" ? "%" : "$"}) for ${partnerDoc.data().name}`,
        metadata: { code: sanitizedCode, partnerId, type, value },
      });

      res.status(201).json({
        success: true,
        message: "Promo code created successfully",
        promoCode: {
          id: docRef.id,
          code: sanitizedCode,
          partnerId,
          partnerName: partnerDoc.data().name,
          type,
          value,
          isActive: true,
        },
      });
    } catch (error) {
      console.error("❌ Error creating promo code:", error);
      res.status(500).json({
        error: "Failed to create promo code",
        message: error.message,
      });
    }
  }
);

/**
 * PATCH /api/admin/promo-codes/:promoCodeId
 * Update a promo code
 * Requires: Super Admin
 */
router.patch(
  "/promo-codes/:promoCodeId",
  verifyToken,
  requireRole(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { promoCodeId } = req.params;
      const updates = req.body;

      // Prevent updating immutable fields
      delete updates.code;
      delete updates.partnerId;
      delete updates.partnerName;
      delete updates.currentUses;
      delete updates.createdAt;
      delete updates.createdBy;

      // Validate type/value if being updated
      if (updates.type) {
        const validTypes = ["percentage", "flat"];
        if (!validTypes.includes(updates.type)) {
          return res.status(400).json({
            error: "Invalid promo code type",
            validTypes,
          });
        }
      }

      if (updates.value !== undefined) {
        if (typeof updates.value !== "number" || updates.value < 0) {
          return res.status(400).json({
            error: "Value must be a non-negative number",
          });
        }
        const promoType = updates.type;
        if (promoType === "percentage" && updates.value > 100) {
          return res.status(400).json({
            error: "Percentage value cannot exceed 100",
          });
        }
      }

      // Convert date strings to Timestamps
      if (updates.validFrom) {
        updates.validFrom = admin.firestore.Timestamp.fromDate(
          new Date(updates.validFrom)
        );
      }
      if (updates.validUntil) {
        updates.validUntil = admin.firestore.Timestamp.fromDate(
          new Date(updates.validUntil)
        );
      }

      const db = admin.firestore();
      const codeRef = db.collection("promoCodes").doc(promoCodeId);
      const codeDoc = await codeRef.get();

      if (!codeDoc.exists) {
        return res.status(404).json({
          error: "Promo code not found",
        });
      }

      await codeRef.update({
        ...updates,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: req.user.uid,
      });

      const updated = await codeRef.get();

      console.log(
        `✅ Admin ${req.user.email} updated promo code: ${codeDoc.data().code}`
      );

      logActivity({
        action: "promo_code.update",
        performedBy: req.user.uid,
        performedByEmail: req.user.email,
        targetId: promoCodeId,
        targetType: "promo_code",
        description: `Updated promo code ${codeDoc.data().code}`,
        metadata: { updatedFields: Object.keys(updates) },
      });

      const data = updated.data();
      res.json({
        success: true,
        message: "Promo code updated successfully",
        promoCode: {
          id: updated.id,
          ...data,
          createdAt: convertTimestamp(data.createdAt),
          updatedAt: convertTimestamp(data.updatedAt),
          validFrom: convertTimestamp(data.validFrom),
          validUntil: convertTimestamp(data.validUntil),
        },
      });
    } catch (error) {
      console.error("❌ Error updating promo code:", error);
      res.status(500).json({
        error: "Failed to update promo code",
        message: error.message,
      });
    }
  }
);

/**
 * DELETE /api/admin/promo-codes/:promoCodeId
 * Delete a promo code
 * Requires: Super Admin
 */
router.delete(
  "/promo-codes/:promoCodeId",
  verifyToken,
  requireRole(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { promoCodeId } = req.params;
      const db = admin.firestore();
      const codeRef = db.collection("promoCodes").doc(promoCodeId);
      const codeDoc = await codeRef.get();

      if (!codeDoc.exists) {
        return res.status(404).json({
          error: "Promo code not found",
        });
      }

      const codeData = codeDoc.data();
      await codeRef.delete();

      console.log(
        `✅ Admin ${req.user.email} deleted promo code: ${codeData.code}`
      );

      logActivity({
        action: "promo_code.delete",
        performedBy: req.user.uid,
        performedByEmail: req.user.email,
        targetId: promoCodeId,
        targetType: "promo_code",
        description: `Deleted promo code ${codeData.code}`,
        metadata: { code: codeData.code, partnerId: codeData.partnerId },
      });

      res.json({
        success: true,
        message: "Promo code deleted successfully",
      });
    } catch (error) {
      console.error("❌ Error deleting promo code:", error);
      res.status(500).json({
        error: "Failed to delete promo code",
        message: error.message,
      });
    }
  }
);

module.exports = router;

// ============================================
// ORPHAN DATA DETECTION
// ============================================

/**
 * GET /api/admin/orphans
 * Scan for orphaned data across collections
 * Finds: docs with no user, inactive docs, certifiedDocs with no bulletin, etc.
 * Requires: Super Admin
 */
router.get(
  "/orphans",
  verifyToken,
  requireRole(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const db = admin.firestore();
      const orphans = [];

      // 1. Bulletins with missing or empty userId
      const bulletinsSnap = await db.collection("bulletins").limit(500).get();
      const allUserIds = new Set();

      bulletinsSnap.forEach((doc) => {
        const data = doc.data();
        if (data.userId) allUserIds.add(data.userId);

        if (!data.userId || data.userId === "") {
          orphans.push({
            id: doc.id,
            collection: "bulletins",
            type: "no_user",
            reason: "Document has no associated user",
            studentName:
              data.metadata?.studentName || data.studentName || "Unknown",
            formType: data.metadata?.formType || data.formType || "unknown",
            createdAt: convertTimestamp(
              data.metadata?.uploadedAt || data.createdAt
            ),
            isActive: data.isActive !== false,
          });
        }
      });

      // 2. Inactive bulletins (soft-deleted but still in DB)
      bulletinsSnap.forEach((doc) => {
        const data = doc.data();
        if (data.isActive === false) {
          orphans.push({
            id: doc.id,
            collection: "bulletins",
            type: "inactive",
            reason: "Document is inactive (soft-deleted)",
            studentName:
              data.metadata?.studentName || data.studentName || "Unknown",
            formType: data.metadata?.formType || data.formType || "unknown",
            createdAt: convertTimestamp(
              data.metadata?.uploadedAt || data.createdAt
            ),
            userId: data.userId || null,
            userEmail: data.userEmail || null,
            isActive: false,
          });
        }
      });

      // 3. CertifiedDocuments with no matching bulletin or inactive
      const certSnap = await db.collection("certifiedDocuments").limit(500).get();
      certSnap.forEach((doc) => {
        const data = doc.data();

        if (!data.userId || data.userId === "") {
          orphans.push({
            id: doc.id,
            collection: "certifiedDocuments",
            type: "no_user",
            reason: "Certified document has no associated user",
            studentName:
              data.originalData?.academicInfo?.studentName ||
              data.originalData?.studentName ||
              "Unknown",
            formType: data.formType || "unknown",
            createdAt: convertTimestamp(data.createdAt),
            isActive: data.isActive !== false,
          });
        }

        if (data.isActive === false) {
          orphans.push({
            id: doc.id,
            collection: "certifiedDocuments",
            type: "inactive",
            reason: "Certified document is inactive (soft-deleted)",
            studentName:
              data.originalData?.academicInfo?.studentName ||
              data.originalData?.studentName ||
              "Unknown",
            formType: data.formType || "unknown",
            createdAt: convertTimestamp(data.createdAt),
            userId: data.userId || null,
            userEmail: data.userEmail || null,
            isActive: false,
          });
        }
      });

      // 4. Documents collection orphans
      const docsSnap = await db.collection("documents").limit(500).get();
      docsSnap.forEach((doc) => {
        const data = doc.data();

        if (!data.userId || data.userId === "") {
          orphans.push({
            id: doc.id,
            collection: "documents",
            type: "no_user",
            reason: "Legacy document has no associated user",
            studentName:
              data.studentName || data.extractedData?.studentName || "Unknown",
            formType: data.formType || "unknown",
            createdAt: convertTimestamp(data.createdAt),
            isActive: true,
          });
        }
      });

      // Deduplicate (same doc could appear in both no_user and inactive)
      const seen = new Set();
      const uniqueOrphans = orphans.filter((o) => {
        const key = `${o.collection}:${o.id}:${o.type}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Summary stats
      const summary = {
        total: uniqueOrphans.length,
        byType: {
          no_user: uniqueOrphans.filter((o) => o.type === "no_user").length,
          inactive: uniqueOrphans.filter((o) => o.type === "inactive").length,
        },
        byCollection: {
          bulletins: uniqueOrphans.filter((o) => o.collection === "bulletins")
            .length,
          certifiedDocuments: uniqueOrphans.filter(
            (o) => o.collection === "certifiedDocuments"
          ).length,
          documents: uniqueOrphans.filter((o) => o.collection === "documents")
            .length,
        },
      };

      res.json({
        success: true,
        orphans: uniqueOrphans,
        summary,
      });
    } catch (error) {
      console.error("❌ Error scanning for orphans:", error);
      res.status(500).json({
        error: "Failed to scan for orphan data",
        message: error.message,
      });
    }
  }
);

/**
 * DELETE /api/admin/orphans/:collection/:id
 * Permanently delete an orphaned record
 * Requires: Super Admin
 */
router.delete(
  "/orphans/:collection/:id",
  verifyToken,
  requireRole(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { collection, id } = req.params;
      const allowedCollections = [
        "bulletins",
        "certifiedDocuments",
        "documents",
      ];

      if (!allowedCollections.includes(collection)) {
        return res
          .status(400)
          .json({ error: "Invalid collection", code: "INVALID_COLLECTION" });
      }

      const db = admin.firestore();
      const docRef = db.collection(collection).doc(id);
      const doc = await docRef.get();

      if (!doc.exists) {
        return res
          .status(404)
          .json({ error: "Record not found", code: "NOT_FOUND" });
      }

      const data = doc.data();
      await docRef.delete();

      logActivity({
        action: "orphan.delete",
        performedBy: req.user.uid,
        performedByEmail: req.user.email,
        targetId: id,
        targetType: collection,
        description: `Permanently deleted orphan from ${collection}: ${
          data.metadata?.studentName ||
          data.studentName ||
          data.originalData?.studentName ||
          id
        }`,
        metadata: { collection, orphanType: req.query.type || "unknown" },
      });

      console.log(
        `✅ Admin ${req.user.email} deleted orphan ${collection}/${id}`
      );

      res.json({
        success: true,
        message: "Orphan record permanently deleted",
      });
    } catch (error) {
      console.error("❌ Error deleting orphan:", error);
      res.status(500).json({
        error: "Failed to delete orphan record",
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/admin/orphans/bulk-delete
 * Bulk delete multiple orphaned records
 * Requires: Super Admin
 */
router.post(
  "/orphans/bulk-delete",
  verifyToken,
  requireRole(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { items } = req.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "No items specified" });
      }

      if (items.length > 50) {
        return res
          .status(400)
          .json({ error: "Maximum 50 items per bulk delete" });
      }

      const allowedCollections = [
        "bulletins",
        "certifiedDocuments",
        "documents",
      ];
      const db = admin.firestore();
      const batch = db.batch();
      let deletedCount = 0;

      for (const item of items) {
        if (
          !item.collection ||
          !item.id ||
          !allowedCollections.includes(item.collection)
        ) {
          continue;
        }
        const docRef = db.collection(item.collection).doc(item.id);
        batch.delete(docRef);
        deletedCount++;
      }

      if (deletedCount > 0) {
        await batch.commit();

        logActivity({
          action: "orphan.bulk_delete",
          performedBy: req.user.uid,
          performedByEmail: req.user.email,
          targetId: null,
          targetType: "orphan_data",
          description: `Bulk deleted ${deletedCount} orphan records`,
          metadata: { count: deletedCount },
        });

        console.log(
          `✅ Admin ${req.user.email} bulk deleted ${deletedCount} orphans`
        );
      }

      res.json({
        success: true,
        deletedCount,
        message: `${deletedCount} records permanently deleted`,
      });
    } catch (error) {
      console.error("❌ Error bulk deleting orphans:", error);
      res.status(500).json({
        error: "Failed to bulk delete orphan records",
        message: error.message,
      });
    }
  }
);

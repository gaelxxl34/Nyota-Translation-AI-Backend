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
      const snapshot = await db
        .collection("partners")
        .orderBy("createdAt", "desc")
        .get();

      const partners = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

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

      const validTypes = ["university", "highschool", "organization"];
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
      const partnerDoc = await db.collection("partners").doc(partnerId).get();

      if (!partnerDoc.exists) {
        return res.status(404).json({
          error: "Partner not found",
          code: "PARTNER_NOT_FOUND",
        });
      }

      res.json({
        success: true,
        partner: { id: partnerDoc.id, ...partnerDoc.data() },
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

      res.json({
        success: true,
        analytics: {
          users: userStats,
          documents: documentStats,
          partners: partnerStats,
          generatedAt: new Date().toISOString(),
        },
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

module.exports = router;

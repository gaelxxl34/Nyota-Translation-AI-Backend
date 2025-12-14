// Partner Routes for NTC
// Handles partner organization dashboard, documents, reports, and statistics

const express = require("express");
const { verifyToken } = require("../auth");
const { ROLES, requireRole, attachRoleInfo } = require("../middleware/rbac");
const admin = require("firebase-admin");

const router = express.Router();
const db = admin.firestore();

// Apply role info middleware to all partner routes
router.use(attachRoleInfo());

// ============================================
// PARTNER DASHBOARD ROUTES
// ============================================

/**
 * GET /api/partner/profile
 * Get current partner organization profile
 * Requires: Partner or Super Admin role
 */
router.get(
  "/profile",
  verifyToken,
  requireRole([ROLES.PARTNER, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const partnerId = req.user.partnerId;

      if (!partnerId && req.user.role !== ROLES.SUPER_ADMIN) {
        return res.status(400).json({
          error: "No partner organization associated with this account",
        });
      }

      // For super admin without partnerId, return empty profile
      if (!partnerId) {
        return res.json({
          success: true,
          partner: null,
          message: "Super admin - no specific partner assigned",
        });
      }

      const partnerDoc = await db.collection("partners").doc(partnerId).get();

      if (!partnerDoc.exists) {
        return res.status(404).json({
          error: "Partner organization not found",
        });
      }

      const partnerData = partnerDoc.data();

      res.json({
        success: true,
        partner: {
          id: partnerDoc.id,
          partnerId: partnerData.partnerId,
          name: partnerData.name,
          shortCode: partnerData.shortCode,
          type: partnerData.type,
          email: partnerData.email,
          phone: partnerData.phone,
          address: partnerData.address,
          logo: partnerData.logo,
          primaryColor: partnerData.primaryColor,
          stats: partnerData.stats,
          pricing: partnerData.pricing,
          commissionEnabled: partnerData.commissionEnabled,
          commissionTiers: partnerData.commissionTiers,
          isActive: partnerData.isActive,
          createdAt: partnerData.createdAt?.toDate?.() || partnerData.createdAt,
        },
      });
    } catch (error) {
      console.error("❌ Error fetching partner profile:", error);
      res.status(500).json({
        error: "Failed to fetch partner profile",
        message: error.message,
      });
    }
  }
);

// ============================================
// STUDENT DOCUMENTS ROUTES
// ============================================

/**
 * GET /api/partner/documents
 * Get documents for partner's students
 * Requires: Partner or Super Admin role
 */
router.get(
  "/documents",
  verifyToken,
  requireRole([ROLES.PARTNER, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const partnerId = req.user.partnerId;
      const {
        status,
        formType,
        search,
        limit = 50,
        startAfter,
        startDate,
        endDate,
      } = req.query;

      if (!partnerId && req.user.role !== ROLES.SUPER_ADMIN) {
        return res.status(400).json({
          error: "No partner organization associated with this account",
        });
      }

      let query = db.collection("documents");

      // Filter by partner ID
      if (partnerId) {
        query = query.where("partnerId", "==", partnerId);
      }

      // Filter by status
      if (status) {
        query = query.where("status", "==", status);
      }

      // Filter by form type
      if (formType) {
        query = query.where("formType", "==", formType);
      }

      // Date range filter
      if (startDate) {
        query = query.where("createdAt", ">=", new Date(startDate));
      }
      if (endDate) {
        query = query.where("createdAt", "<=", new Date(endDate));
      }

      // Order by creation date
      query = query.orderBy("createdAt", "desc");

      // Pagination
      if (startAfter) {
        const startDoc = await db.collection("documents").doc(startAfter).get();
        if (startDoc.exists) {
          query = query.startAfter(startDoc);
        }
      }

      query = query.limit(parseInt(limit, 10));

      const snapshot = await query.get();
      let documents = [];

      snapshot.forEach((doc) => {
        const data = doc.data();
        documents.push({
          id: doc.id,
          userId: data.userId,
          userEmail: data.userEmail,
          formType: data.formType,
          status: data.status,
          studentName: data.studentName || data.extractedData?.studentName,
          schoolName: data.schoolName || data.extractedData?.schoolName,
          className: data.className || data.extractedData?.class,
          academicYear: data.academicYear || data.extractedData?.academicYear,
          createdAt: data.createdAt?.toDate?.() || data.createdAt,
          approvedAt: data.approvedAt?.toDate?.() || data.approvedAt,
          pdfUrl: data.pdfUrl,
        });
      });

      // Client-side search filter (for student name)
      if (search) {
        const searchLower = search.toLowerCase();
        documents = documents.filter(
          (doc) =>
            doc.studentName?.toLowerCase().includes(searchLower) ||
            doc.userEmail?.toLowerCase().includes(searchLower)
        );
      }

      res.json({
        success: true,
        documents,
        count: documents.length,
      });
    } catch (error) {
      console.error("❌ Error fetching partner documents:", error);
      res.status(500).json({
        error: "Failed to fetch documents",
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/partner/documents/:docId
 * Get single document detail
 * Requires: Partner or Super Admin role
 */
router.get(
  "/documents/:docId",
  verifyToken,
  requireRole([ROLES.PARTNER, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { docId } = req.params;
      const partnerId = req.user.partnerId;

      const docRef = db.collection("documents").doc(docId);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        return res.status(404).json({
          error: "Document not found",
        });
      }

      const data = docSnap.data();

      // Verify document belongs to partner
      if (partnerId && data.partnerId !== partnerId) {
        return res.status(403).json({
          error: "Access denied - document belongs to different organization",
        });
      }

      res.json({
        success: true,
        document: {
          id: docSnap.id,
          userId: data.userId,
          userEmail: data.userEmail,
          formType: data.formType,
          status: data.status,
          studentName: data.studentName || data.extractedData?.studentName,
          schoolName: data.schoolName || data.extractedData?.schoolName,
          extractedData: data.extractedData,
          translatedData: data.translatedData,
          pdfUrl: data.pdfUrl,
          originalFileUrl: data.originalFileUrl,
          createdAt: data.createdAt?.toDate?.() || data.createdAt,
          approvedAt: data.approvedAt?.toDate?.() || data.approvedAt,
          approvedByName: data.approvedByName,
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

// ============================================
// STATISTICS ROUTES
// ============================================

/**
 * GET /api/partner/stats
 * Get partner usage statistics
 * Requires: Partner or Super Admin role
 */
router.get(
  "/stats",
  verifyToken,
  requireRole([ROLES.PARTNER, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const partnerId = req.user.partnerId;
      const { period = "month" } = req.query;

      if (!partnerId && req.user.role !== ROLES.SUPER_ADMIN) {
        return res.status(400).json({
          error: "No partner organization associated with this account",
        });
      }

      // Calculate date range
      const now = new Date();
      let startDate;

      switch (period) {
        case "week":
          startDate = new Date(now.setDate(now.getDate() - 7));
          break;
        case "month":
          startDate = new Date(now.setMonth(now.getMonth() - 1));
          break;
        case "quarter":
          startDate = new Date(now.setMonth(now.getMonth() - 3));
          break;
        case "year":
          startDate = new Date(now.setFullYear(now.getFullYear() - 1));
          break;
        default:
          startDate = null;
      }

      // Build query
      let baseQuery = db.collection("documents");
      if (partnerId) {
        baseQuery = baseQuery.where("partnerId", "==", partnerId);
      }

      // Get all documents for partner
      const allDocsSnap = await baseQuery.get();

      // Get documents in period
      let periodQuery = baseQuery;
      if (startDate) {
        periodQuery = periodQuery.where("createdAt", ">=", startDate);
      }
      const periodDocsSnap = await periodQuery.get();

      // Calculate stats
      const stats = {
        totalDocuments: allDocsSnap.size,
        documentsInPeriod: periodDocsSnap.size,
        byStatus: {},
        byFormType: {},
        byMonth: [],
      };

      // Count by status and form type
      allDocsSnap.forEach((doc) => {
        const data = doc.data();

        // By status
        stats.byStatus[data.status] = (stats.byStatus[data.status] || 0) + 1;

        // By form type
        stats.byFormType[data.formType] =
          (stats.byFormType[data.formType] || 0) + 1;
      });

      // Monthly breakdown (last 6 months)
      const monthlyStats = {};
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      allDocsSnap.forEach((doc) => {
        const data = doc.data();
        const createdAt =
          data.createdAt?.toDate?.() || new Date(data.createdAt);

        if (createdAt >= sixMonthsAgo) {
          const monthKey = `${createdAt.getFullYear()}-${String(
            createdAt.getMonth() + 1
          ).padStart(2, "0")}`;
          monthlyStats[monthKey] = (monthlyStats[monthKey] || 0) + 1;
        }
      });

      // Convert to array and sort
      stats.byMonth = Object.entries(monthlyStats)
        .map(([month, count]) => ({ month, count }))
        .sort((a, b) => a.month.localeCompare(b.month));

      // Get unique students count
      const uniqueStudents = new Set();
      allDocsSnap.forEach((doc) => {
        const data = doc.data();
        if (data.userId) uniqueStudents.add(data.userId);
      });
      stats.uniqueStudents = uniqueStudents.size;

      // Approved documents
      stats.approvedDocuments = stats.byStatus["approved"] || 0;
      stats.pendingDocuments =
        (stats.byStatus["pending_review"] || 0) +
        (stats.byStatus["in_review"] || 0) +
        (stats.byStatus["ai_completed"] || 0);

      res.json({
        success: true,
        stats,
        period,
      });
    } catch (error) {
      console.error("❌ Error fetching partner stats:", error);
      res.status(500).json({
        error: "Failed to fetch statistics",
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/partner/stats/usage
 * Get detailed usage breakdown for billing
 * Requires: Partner or Super Admin role
 */
router.get(
  "/stats/usage",
  verifyToken,
  requireRole([ROLES.PARTNER, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const partnerId = req.user.partnerId;
      const { month, year } = req.query;

      if (!partnerId && req.user.role !== ROLES.SUPER_ADMIN) {
        return res.status(400).json({
          error: "No partner organization associated with this account",
        });
      }

      // Default to current month
      const targetMonth = month
        ? parseInt(month, 10) - 1
        : new Date().getMonth();
      const targetYear = year ? parseInt(year, 10) : new Date().getFullYear();

      const startOfMonth = new Date(targetYear, targetMonth, 1);
      const endOfMonth = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59);

      let query = db.collection("documents");
      if (partnerId) {
        query = query.where("partnerId", "==", partnerId);
      }
      query = query
        .where("createdAt", ">=", startOfMonth)
        .where("createdAt", "<=", endOfMonth);

      const snapshot = await query.get();

      const usage = {
        month: targetMonth + 1,
        year: targetYear,
        totalDocuments: snapshot.size,
        byFormType: {},
        byDay: {},
        estimatedCost: 0,
      };

      // Pricing per document type (example rates)
      const pricing = {
        bulletin: 5,
        state_diploma: 10,
        bachelor_diploma: 15,
        college_transcript: 8,
        attestation: 7,
        default: 5,
      };

      snapshot.forEach((doc) => {
        const data = doc.data();
        const createdAt =
          data.createdAt?.toDate?.() || new Date(data.createdAt);
        const day = createdAt.getDate();

        // By form type
        usage.byFormType[data.formType] =
          (usage.byFormType[data.formType] || 0) + 1;

        // By day
        usage.byDay[day] = (usage.byDay[day] || 0) + 1;

        // Calculate cost
        const rate = pricing[data.formType] || pricing.default;
        usage.estimatedCost += rate;
      });

      // Get partner discount
      if (partnerId) {
        const partnerDoc = await db.collection("partners").doc(partnerId).get();
        if (partnerDoc.exists) {
          const partnerData = partnerDoc.data();
          const discount = partnerData.pricing?.discountPercent || 0;
          usage.discountPercent = discount;
          usage.discountAmount = (usage.estimatedCost * discount) / 100;
          usage.finalCost = usage.estimatedCost - usage.discountAmount;
        }
      } else {
        usage.finalCost = usage.estimatedCost;
      }

      res.json({
        success: true,
        usage,
      });
    } catch (error) {
      console.error("❌ Error fetching usage stats:", error);
      res.status(500).json({
        error: "Failed to fetch usage statistics",
        message: error.message,
      });
    }
  }
);

// ============================================
// REPORTS ROUTES
// ============================================

/**
 * GET /api/partner/reports/documents
 * Generate documents report (CSV format)
 * Requires: Partner or Super Admin role
 */
router.get(
  "/reports/documents",
  verifyToken,
  requireRole([ROLES.PARTNER, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const partnerId = req.user.partnerId;
      const {
        startDate,
        endDate,
        status,
        formType,
        format = "json",
      } = req.query;

      if (!partnerId && req.user.role !== ROLES.SUPER_ADMIN) {
        return res.status(400).json({
          error: "No partner organization associated with this account",
        });
      }

      let query = db.collection("documents");

      if (partnerId) {
        query = query.where("partnerId", "==", partnerId);
      }

      if (startDate) {
        query = query.where("createdAt", ">=", new Date(startDate));
      }
      if (endDate) {
        query = query.where("createdAt", "<=", new Date(endDate));
      }
      if (status) {
        query = query.where("status", "==", status);
      }
      if (formType) {
        query = query.where("formType", "==", formType);
      }

      query = query.orderBy("createdAt", "desc");

      const snapshot = await query.get();
      const documents = [];

      snapshot.forEach((doc) => {
        const data = doc.data();
        documents.push({
          id: doc.id,
          studentName:
            data.studentName || data.extractedData?.studentName || "N/A",
          userEmail: data.userEmail,
          formType: data.formType,
          status: data.status,
          schoolName:
            data.schoolName || data.extractedData?.schoolName || "N/A",
          className: data.className || data.extractedData?.class || "N/A",
          academicYear:
            data.academicYear || data.extractedData?.academicYear || "N/A",
          createdAt: data.createdAt?.toDate?.().toISOString() || data.createdAt,
          approvedAt:
            data.approvedAt?.toDate?.().toISOString() ||
            data.approvedAt ||
            "N/A",
        });
      });

      if (format === "csv") {
        // Generate CSV
        const headers = [
          "Document ID",
          "Student Name",
          "Email",
          "Form Type",
          "Status",
          "School",
          "Class",
          "Academic Year",
          "Created At",
          "Approved At",
        ];

        const csvRows = [headers.join(",")];

        documents.forEach((doc) => {
          const row = [
            doc.id,
            `"${doc.studentName}"`,
            doc.userEmail,
            doc.formType,
            doc.status,
            `"${doc.schoolName}"`,
            `"${doc.className}"`,
            doc.academicYear,
            doc.createdAt,
            doc.approvedAt,
          ];
          csvRows.push(row.join(","));
        });

        const csv = csvRows.join("\n");

        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="documents-report-${
            new Date().toISOString().split("T")[0]
          }.csv"`
        );
        return res.send(csv);
      }

      res.json({
        success: true,
        report: {
          generatedAt: new Date().toISOString(),
          totalDocuments: documents.length,
          filters: { startDate, endDate, status, formType },
          documents,
        },
      });
    } catch (error) {
      console.error("❌ Error generating documents report:", error);
      res.status(500).json({
        error: "Failed to generate report",
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/partner/reports/summary
 * Generate summary report
 * Requires: Partner or Super Admin role
 */
router.get(
  "/reports/summary",
  verifyToken,
  requireRole([ROLES.PARTNER, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const partnerId = req.user.partnerId;
      const { month, year } = req.query;

      if (!partnerId && req.user.role !== ROLES.SUPER_ADMIN) {
        return res.status(400).json({
          error: "No partner organization associated with this account",
        });
      }

      // Default to current month
      const targetMonth = month
        ? parseInt(month, 10) - 1
        : new Date().getMonth();
      const targetYear = year ? parseInt(year, 10) : new Date().getFullYear();

      const startOfMonth = new Date(targetYear, targetMonth, 1);
      const endOfMonth = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59);

      // Get partner info
      let partnerInfo = null;
      if (partnerId) {
        const partnerDoc = await db.collection("partners").doc(partnerId).get();
        if (partnerDoc.exists) {
          partnerInfo = partnerDoc.data();
        }
      }

      // Get documents for the month
      let query = db.collection("documents");
      if (partnerId) {
        query = query.where("partnerId", "==", partnerId);
      }
      query = query
        .where("createdAt", ">=", startOfMonth)
        .where("createdAt", "<=", endOfMonth);

      const snapshot = await query.get();

      const summary = {
        partner: partnerInfo
          ? {
              name: partnerInfo.name,
              shortCode: partnerInfo.shortCode,
              type: partnerInfo.type,
            }
          : null,
        period: {
          month: targetMonth + 1,
          year: targetYear,
          monthName: new Date(targetYear, targetMonth).toLocaleString(
            "default",
            { month: "long" }
          ),
        },
        totals: {
          documents: snapshot.size,
          byStatus: {},
          byFormType: {},
        },
        uniqueStudents: 0,
      };

      const uniqueStudents = new Set();

      snapshot.forEach((doc) => {
        const data = doc.data();

        summary.totals.byStatus[data.status] =
          (summary.totals.byStatus[data.status] || 0) + 1;
        summary.totals.byFormType[data.formType] =
          (summary.totals.byFormType[data.formType] || 0) + 1;

        if (data.userId) uniqueStudents.add(data.userId);
      });

      summary.uniqueStudents = uniqueStudents.size;

      res.json({
        success: true,
        summary,
      });
    } catch (error) {
      console.error("❌ Error generating summary report:", error);
      res.status(500).json({
        error: "Failed to generate summary report",
        message: error.message,
      });
    }
  }
);

// ============================================
// BRANDING ROUTES
// ============================================

/**
 * PUT /api/partner/branding
 * Update partner branding options
 * Requires: Partner or Super Admin role
 */
router.put(
  "/branding",
  verifyToken,
  requireRole([ROLES.PARTNER, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const partnerId = req.user.partnerId;
      const { logo, primaryColor } = req.body;

      if (!partnerId) {
        return res.status(400).json({
          error: "No partner organization associated with this account",
        });
      }

      const updateData = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (logo !== undefined) {
        updateData.logo = logo;
      }

      if (primaryColor !== undefined) {
        // Validate hex color
        if (!/^#[0-9A-Fa-f]{6}$/.test(primaryColor)) {
          return res.status(400).json({
            error: "Invalid color format. Use hex format: #RRGGBB",
          });
        }
        updateData.primaryColor = primaryColor;
      }

      await db.collection("partners").doc(partnerId).update(updateData);

      res.json({
        success: true,
        message: "Branding updated successfully",
      });
    } catch (error) {
      console.error("❌ Error updating branding:", error);
      res.status(500).json({
        error: "Failed to update branding",
        message: error.message,
      });
    }
  }
);

// ============================================
// STUDENTS/USERS ROUTES
// ============================================

/**
 * GET /api/partner/students
 * Get list of students associated with partner
 * Requires: Partner or Super Admin role
 */
router.get(
  "/students",
  verifyToken,
  requireRole([ROLES.PARTNER, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const partnerId = req.user.partnerId;
      const { limit = 50, search } = req.query;

      if (!partnerId && req.user.role !== ROLES.SUPER_ADMIN) {
        return res.status(400).json({
          error: "No partner organization associated with this account",
        });
      }

      // Get unique users who have submitted documents
      let query = db.collection("documents");
      if (partnerId) {
        query = query.where("partnerId", "==", partnerId);
      }

      const snapshot = await query.get();

      const studentsMap = new Map();

      snapshot.forEach((doc) => {
        const data = doc.data();
        const key = data.userId || data.userEmail;

        if (!studentsMap.has(key)) {
          studentsMap.set(key, {
            id: data.userId,
            email: data.userEmail,
            name:
              data.studentName || data.extractedData?.studentName || "Unknown",
            documentsCount: 1,
            lastDocument: data.createdAt?.toDate?.() || data.createdAt,
          });
        } else {
          const student = studentsMap.get(key);
          student.documentsCount++;
          const docDate =
            data.createdAt?.toDate?.() || new Date(data.createdAt);
          if (docDate > new Date(student.lastDocument)) {
            student.lastDocument = docDate;
          }
        }
      });

      let students = Array.from(studentsMap.values());

      // Search filter
      if (search) {
        const searchLower = search.toLowerCase();
        students = students.filter(
          (s) =>
            s.name?.toLowerCase().includes(searchLower) ||
            s.email?.toLowerCase().includes(searchLower)
        );
      }

      // Sort by documents count
      students.sort((a, b) => b.documentsCount - a.documentsCount);

      // Apply limit
      students = students.slice(0, parseInt(limit, 10));

      res.json({
        success: true,
        students,
        count: students.length,
      });
    } catch (error) {
      console.error("❌ Error fetching students:", error);
      res.status(500).json({
        error: "Failed to fetch students",
        message: error.message,
      });
    }
  }
);

module.exports = router;

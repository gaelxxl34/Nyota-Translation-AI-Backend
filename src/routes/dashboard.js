// Dashboard Statistics Routes
// Provides analytics data including document counts, user activity, and revenue

const express = require("express");
const admin = require("firebase-admin");
const router = express.Router();

// Initialize Firebase Admin if not already initialized
const { initializeFirebaseAdmin } = require("../auth");

/**
 * GET /api/dashboard/stats
 * Returns comprehensive dashboard statistics:
 * - Total documents translated
 * - Documents by user with email
 * - Revenue generated (65000 per document)
 * - Documents by form type
 * - Recent activity
 */
router.get("/dashboard/stats", async (req, res) => {
  try {
    console.log("📊 Fetching dashboard statistics...");

    const userId = req.user?.uid;
    const userEmail = req.user?.email;
    const isAdmin = req.user?.admin || false; // You can set admin flag via custom claims

    if (!userId) {
      console.error("❌ No user ID found in request");
      return res.status(401).json({
        error: "User not authenticated",
      });
    }

    // Initialize Firebase Admin
    initializeFirebaseAdmin();
    const db = admin.firestore();

    // Price per document
    const PRICE_PER_DOCUMENT = 65000;

    let stats = {};

    // If admin, get all documents; otherwise get only user's documents
    if (isAdmin) {
      console.log("👑 Admin user - fetching all statistics");

      // Get all bulletins
      const allBulletinsSnapshot = await db.collection("bulletins").get();

      const totalDocuments = allBulletinsSnapshot.size;
      const totalRevenue = totalDocuments * PRICE_PER_DOCUMENT;

      // Group documents by user
      const documentsByUser = {};
      const documentsByFormType = {};
      const recentDocuments = [];

      allBulletinsSnapshot.forEach((doc) => {
        const data = doc.data();
        const userIdKey = data.userId || "unknown";
        const userEmailKey = data.userEmail || "unknown@example.com";
        const formType = data.metadata?.formType || "form6";
        const uploadedAt =
          data.metadata?.uploadedAt?.toDate?.() ||
          new Date(data.metadata?.createdAt || Date.now());

        // Group by user
        if (!documentsByUser[userIdKey]) {
          documentsByUser[userIdKey] = {
            userId: userIdKey,
            email: userEmailKey,
            count: 0,
            revenue: 0,
            documents: [],
          };
        }
        documentsByUser[userIdKey].count += 1;
        documentsByUser[userIdKey].revenue += PRICE_PER_DOCUMENT;
        documentsByUser[userIdKey].documents.push({
          id: doc.id,
          studentName: data.metadata?.studentName || "Unknown Student",
          formType: formType,
          uploadedAt: uploadedAt,
        });

        // Group by form type
        if (!documentsByFormType[formType]) {
          documentsByFormType[formType] = 0;
        }
        documentsByFormType[formType] += 1;

        // Collect recent documents
        recentDocuments.push({
          id: doc.id,
          studentName: data.metadata?.studentName || "Unknown Student",
          formType: formType,
          uploadedAt: uploadedAt,
          userEmail: userEmailKey,
        });
      });

      // Sort recent documents by date (newest first) and take top 10
      recentDocuments.sort((a, b) => b.uploadedAt - a.uploadedAt);
      const topRecentDocuments = recentDocuments.slice(0, 10).map((doc) => ({
        ...doc,
        uploadedAt: doc.uploadedAt.toISOString(),
      }));

      // Convert documentsByUser to array and sort by count
      const userStats = Object.values(documentsByUser).sort(
        (a, b) => b.count - a.count
      );

      stats = {
        totalDocuments,
        totalRevenue,
        pricePerDocument: PRICE_PER_DOCUMENT,
        documentsByUser: userStats,
        documentsByFormType,
        recentDocuments: topRecentDocuments,
        isAdmin: true,
      };
    } else {
      console.log("👤 Regular user - fetching personal statistics");

      // Get only current user's bulletins
      const userBulletinsSnapshot = await db
        .collection("bulletins")
        .where("userId", "==", userId)
        .get();

      const totalDocuments = userBulletinsSnapshot.size;
      const totalRevenue = totalDocuments * PRICE_PER_DOCUMENT;

      const documentsByFormType = {};
      const recentDocuments = [];

      userBulletinsSnapshot.forEach((doc) => {
        const data = doc.data();
        const formType = data.metadata?.formType || "form6";
        const uploadedAt =
          data.metadata?.uploadedAt?.toDate?.() ||
          new Date(data.metadata?.createdAt || Date.now());

        // Group by form type
        if (!documentsByFormType[formType]) {
          documentsByFormType[formType] = 0;
        }
        documentsByFormType[formType] += 1;

        // Collect recent documents
        recentDocuments.push({
          id: doc.id,
          studentName: data.metadata?.studentName || "Unknown Student",
          formType: formType,
          uploadedAt: uploadedAt,
        });
      });

      // Sort recent documents by date (newest first) and take top 10
      recentDocuments.sort((a, b) => b.uploadedAt - a.uploadedAt);
      const topRecentDocuments = recentDocuments.slice(0, 10).map((doc) => ({
        ...doc,
        uploadedAt: doc.uploadedAt.toISOString(),
      }));

      stats = {
        totalDocuments,
        totalRevenue,
        pricePerDocument: PRICE_PER_DOCUMENT,
        documentsByUser: [
          {
            userId: userId,
            email: userEmail,
            count: totalDocuments,
            revenue: totalRevenue,
          },
        ],
        documentsByFormType,
        recentDocuments: topRecentDocuments,
        isAdmin: false,
      };
    }

    console.log("✅ Dashboard statistics fetched successfully");
    console.log(`📈 Total documents: ${stats.totalDocuments}`);
    console.log(`💰 Total revenue: ${stats.totalRevenue}`);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("❌ Dashboard statistics fetch failed:", error);
    res.status(500).json({
      error: "Failed to fetch dashboard statistics",
      details: error.message,
    });
  }
});

module.exports = router;

// Bulletins Management Routes
// Handles CRUD operations for bulletins stored in Firestore

const express = require("express");
const admin = require("firebase-admin");
const router = express.Router();

// Initialize Firebase Admin if not already initialized
const { initializeFirebaseAdmin } = require("../auth");

// DELETE /api/bulletins/:id - Delete a bulletin from Firestore
router.delete("/bulletins/:id", async (req, res) => {
  try {
    console.log("🗑️ Starting bulletin deletion process...");

    const { id: bulletinId } = req.params;
    const userId = req.user?.uid;

    if (!bulletinId) {
      console.error("❌ No bulletin ID provided");
      return res.status(400).json({
        error: "Bulletin ID is required",
      });
    }

    if (!userId) {
      console.error("❌ No user ID found in request");
      return res.status(401).json({
        error: "User not authenticated",
      });
    }

    console.log("🔍 Deleting bulletin:", bulletinId, "for user:", userId);

    // Initialize Firebase Admin
    initializeFirebaseAdmin();
    const db = admin.firestore();

    // Get the bulletin document first to verify ownership
    const bulletinDoc = await db.collection("bulletins").doc(bulletinId).get();

    if (!bulletinDoc.exists) {
      console.error("❌ Bulletin not found:", bulletinId);
      return res.status(404).json({
        error: "Bulletin not found",
      });
    }

    const bulletinData = bulletinDoc.data();

    // Verify the bulletin belongs to the authenticated user
    if (bulletinData.userId !== userId) {
      console.error(
        "❌ User",
        userId,
        "attempted to delete bulletin owned by",
        bulletinData.userId
      );
      return res.status(403).json({
        error: "You can only delete your own bulletins",
      });
    }

    // Delete the main bulletin document
    await db.collection("bulletins").doc(bulletinId).delete();
    console.log("✅ Main bulletin document deleted");

    // Also delete any associated versions subcollection
    try {
      const versionsSnapshot = await db
        .collection("bulletins")
        .doc(bulletinId)
        .collection("versions")
        .get();

      if (!versionsSnapshot.empty) {
        const batch = db.batch();
        versionsSnapshot.docs.forEach((versionDoc) => {
          batch.delete(versionDoc.ref);
        });
        await batch.commit();
        console.log(`✅ Deleted ${versionsSnapshot.size} version documents`);
      }
    } catch (versionError) {
      console.warn(
        "⚠️ Could not delete versions subcollection:",
        versionError.message
      );
      // Don't fail the main deletion for this
    }

    console.log("✅ Bulletin deletion completed successfully");

    res.json({
      success: true,
      message: "Bulletin deleted successfully",
      deletedId: bulletinId,
    });
  } catch (error) {
    console.error("❌ Bulletin deletion failed:", error);
    res.status(500).json({
      error: "Failed to delete bulletin",
      details: error.message,
    });
  }
});

module.exports = router;

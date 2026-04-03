// Bulletins Management Routes
// Handles CRUD operations for bulletins stored in Firestore

const express = require("express");
const admin = require("firebase-admin");
const { cache, TTL, keys } = require("../services/cache");
const router = express.Router();

// Initialize Firebase Admin if not already initialized
const { initializeFirebaseAdmin } = require("../auth");
const { deleteFromStorage, downloadFromStorage } = require("../services/storage");

// GET /api/bulletins/my - List current user's bulletins (drafts/processed docs)
router.get("/bulletins/my", async (req, res) => {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    initializeFirebaseAdmin();
    const db = admin.firestore();

    const snapshot = await cache.getOrSet(
      keys.userBulletins(userId),
      TTL.LIST,
      async () => {
        const snap = await db
          .collection("bulletins")
          .where("userId", "==", userId)
          .where("isActive", "==", true)
          .orderBy("metadata.createdAt", "desc")
          .limit(50)
          .get();

        return snap.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            formType: data.metadata?.formType || data.formType || "generalDocument",
            sourceLanguage: data.sourceLanguage || data.metadata?.sourceLanguage || data.originalData?.sourceLanguage || "auto",
            studentName:
              data.originalData?.academicInfo?.studentName ||
              data.originalData?.studentName ||
              data.metadata?.studentName ||
              "Untitled Document",
            documentTitle:
              data.originalData?.documentTitle || data.originalData?.documentType || null,
            status: data.metadata?.status || "processed",
            createdAt: data.metadata?.createdAt || null,
            hasStorageFile: !!data.metadata?.storagePath,
          };
        });
      }
    );

    res.json({ success: true, bulletins: snapshot });
  } catch (error) {
    console.error("❌ Failed to list bulletins:", error.message);
    res.status(500).json({ error: "Failed to load documents", details: error.message });
  }
});

// GET /api/bulletins/:id - Get a single bulletin's data (for resuming drafts)
router.get("/bulletins/:id", async (req, res) => {
  try {
    const { id: bulletinId } = req.params;
    const userId = req.user?.uid;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    initializeFirebaseAdmin();
    const db = admin.firestore();

    const bulletinData = await cache.getOrSet(
      keys.bulletin(bulletinId),
      TTL.DOCUMENT,
      async () => {
        const bulletinDoc = await db.collection("bulletins").doc(bulletinId).get();
        return bulletinDoc.exists ? { ...bulletinDoc.data(), _docId: bulletinDoc.id } : null;
      }
    );

    if (!bulletinData) {
      return res.status(404).json({ error: "Bulletin not found" });
    }

    if (bulletinData.userId !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const data = bulletinData.editedData || bulletinData.originalData;
    const formType = bulletinData.metadata?.formType || bulletinData.formType || "generalDocument";
    const sourceLanguage = bulletinData.sourceLanguage || data?.sourceLanguage || bulletinData.metadata?.sourceLanguage || bulletinData.originalData?.sourceLanguage || "auto";

    res.json({
      success: true,
      bulletin: {
        id: bulletinId,
        formType,
        sourceLanguage,
        data,
        storageUrl: bulletinData.metadata?.storageUrl || null,
        storagePath: bulletinData.metadata?.storagePath || null,
        fileName: bulletinData.metadata?.fileName || null,
        fileSize: bulletinData.metadata?.fileSize || null,
      },
    });
  } catch (error) {
    console.error("❌ Failed to get bulletin:", error.message);
    res.status(500).json({ error: "Failed to load bulletin", details: error.message });
  }
});

// GET /api/bulletins/:id/delete-info - Pre-delete check: what will be removed
router.get("/bulletins/:id/delete-info", async (req, res) => {
  try {
    const { id: bulletinId } = req.params;
    const userId = req.user?.uid;
    if (!userId) return res.status(401).json({ error: "User not authenticated" });

    initializeFirebaseAdmin();
    const db = admin.firestore();

    const bulletinDoc = await db.collection("bulletins").doc(bulletinId).get();
    if (!bulletinDoc.exists) return res.status(404).json({ error: "Bulletin not found" });
    if (bulletinDoc.data().userId !== userId) return res.status(403).json({ error: "Access denied" });

    // Find linked certifiedDocuments
    const certSnap = await db
      .collection("certifiedDocuments")
      .where("bulletinId", "==", bulletinId)
      .where("userId", "==", userId)
      .get();

    const linkedSubmissions = certSnap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        status: data.status,
        formType: data.formType,
        certificationId: data.certification?.certificationId || null,
        createdAt: data.createdAt,
      };
    });

    // Count versions
    const versionsSnap = await db
      .collection("bulletins")
      .doc(bulletinId)
      .collection("versions")
      .get();

    // Count payments and invoices linked to certifiedDocuments
    let paymentsCount = 0;
    let invoicesCount = 0;
    for (const certDoc of certSnap.docs) {
      const paymentsSnap = await db.collection("payments")
        .where("certDocId", "==", certDoc.id)
        .get();
      paymentsCount += paymentsSnap.size;
      const invoicesSnap = await db.collection("invoices")
        .where("certDocId", "==", certDoc.id)
        .get();
      invoicesCount += invoicesSnap.size;
    }

    res.json({
      success: true,
      bulletinId,
      hasStorageFile: !!bulletinDoc.data().metadata?.storagePath,
      versionsCount: versionsSnap.size,
      linkedSubmissions,
      paymentsCount,
      invoicesCount,
    });
  } catch (error) {
    console.error("❌ Delete info check failed:", error.message);
    res.status(500).json({ error: "Failed to check delete info" });
  }
});

// DELETE /api/bulletins/:id - Delete a bulletin and ALL related data from Firestore
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

    // 1. Delete bulletin's uploaded file from Firebase Storage
    if (bulletinData.metadata?.storagePath) {
      try {
        await deleteFromStorage(bulletinData.metadata.storagePath);
        console.log("✅ Storage file deleted:", bulletinData.metadata.storagePath);
      } catch (storageErr) {
        console.warn("⚠️ Could not delete Storage file:", storageErr.message);
      }
    }

    // 2. Find and delete ALL linked certifiedDocuments + their storage files
    let deletedSubmissions = 0;
    try {
      const certSnap = await db
        .collection("certifiedDocuments")
        .where("bulletinId", "==", bulletinId)
        .where("userId", "==", userId)
        .get();

      if (!certSnap.empty) {
        for (const certDoc of certSnap.docs) {
          const certData = certDoc.data();

          // Delete certified PDF from Cloud Storage
          if (certData.certification?.pdfStoragePath) {
            try {
              await deleteFromStorage(certData.certification.pdfStoragePath);
              console.log("✅ Certified PDF deleted:", certData.certification.pdfStoragePath);
            } catch (err) {
              console.warn("⚠️ Could not delete certified PDF:", err.message);
            }
          }

          // Delete the original upload stored for the certified doc
          if (certData.metadata?.storagePath) {
            try {
              await deleteFromStorage(certData.metadata.storagePath);
              console.log("✅ Cert doc upload deleted:", certData.metadata.storagePath);
            } catch (err) {
              console.warn("⚠️ Could not delete cert doc upload:", err.message);
            }
          }

          // Delete the certifiedDocument record
          await certDoc.ref.delete();
          deletedSubmissions++;

          // Delete related payments and invoices
          try {
            const paymentsSnap = await db.collection("payments")
              .where("certDocId", "==", certDoc.id)
              .get();
            for (const payDoc of paymentsSnap.docs) {
              await payDoc.ref.delete();
            }
            const invoicesSnap = await db.collection("invoices")
              .where("certDocId", "==", certDoc.id)
              .get();
            for (const invDoc of invoicesSnap.docs) {
              await invDoc.ref.delete();
            }
          } catch (payErr) {
            console.warn("⚠️ Could not delete related payments/invoices:", payErr.message);
          }

          // Invalidate cache for this cert doc
          await cache.del(keys.certDoc(certDoc.id));
        }
        console.log(`✅ Deleted ${deletedSubmissions} linked certified documents`);

        // Invalidate user cert docs cache
        await cache.del(keys.userCertDocs(userId));
      }
    } catch (certError) {
      console.warn("⚠️ Could not delete linked certifiedDocuments:", certError.message);
    }

    // 3. Delete the main bulletin document
    await db.collection("bulletins").doc(bulletinId).delete();
    console.log("✅ Main bulletin document deleted");

    // 4. Invalidate bulletin caches
    await cache.del(keys.bulletin(bulletinId));
    await cache.del(keys.userBulletins(userId));

    // 5. Delete versions subcollection
    let deletedVersions = 0;
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
        deletedVersions = versionsSnapshot.size;
        console.log(`✅ Deleted ${deletedVersions} version documents`);
      }
    } catch (versionError) {
      console.warn(
        "⚠️ Could not delete versions subcollection:",
        versionError.message
      );
    }

    console.log("✅ Bulletin deletion completed successfully (cascade)");

    res.json({
      success: true,
      message: "Bulletin and all related data deleted successfully",
      deletedId: bulletinId,
      deletedSubmissions,
      deletedVersions,
    });
  } catch (error) {
    console.error("❌ Bulletin deletion failed:", error);
    res.status(500).json({
      error: "Failed to delete bulletin",
      details: error.message,
    });
  }
});

// POST /api/bulletins/:id/retry - Retry AI processing for a failed bulletin
router.post("/bulletins/:id/retry", async (req, res) => {
  try {
    const { id: bulletinId } = req.params;
    const userId = req.user?.uid;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    initializeFirebaseAdmin();
    const db = admin.firestore();

    const bulletinDoc = await db.collection("bulletins").doc(bulletinId).get();
    if (!bulletinDoc.exists) {
      return res.status(404).json({ error: "Bulletin not found" });
    }

    const bulletinData = bulletinDoc.data();
    if (bulletinData.userId !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const status = bulletinData.metadata?.status;
    if (status !== "processing_failed" && status !== "failed") {
      return res.status(400).json({ error: "Document is not in a failed state" });
    }

    const storagePath = bulletinData.metadata?.storagePath;
    if (!storagePath) {
      return res.status(400).json({ error: "No stored file found for this document. Please upload again." });
    }

    // Download file from Firebase Storage to a temp location
    const path = require("path");
    const os = require("os");
    const ext = path.extname(bulletinData.metadata?.fileName || ".pdf");
    const tempPath = path.join(os.tmpdir(), `retry_${bulletinId}_${Date.now()}${ext}`);

    const downloadResult = await downloadFromStorage(storagePath, tempPath);
    if (!downloadResult.success) {
      return res.status(500).json({ error: "Failed to retrieve stored file: " + downloadResult.error });
    }

    // Process with AI
    const aiRouter = require("../ai-router");
    const formType = bulletinData.formType || bulletinData.metadata?.formType || "generalDocument";
    const sourceLanguage = bulletinData.sourceLanguage || bulletinData.metadata?.sourceLanguage || "auto";
    const targetLanguage = bulletinData.metadata?.targetLanguage || "english";

    console.log(`🔄 Retrying AI processing for bulletin ${bulletinId} (${formType})...`);

    const processingTimeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("AI processing timeout after 4 minutes")), 240000);
    });

    let extractionResult;
    try {
      extractionResult = await Promise.race([
        aiRouter.processDocument(tempPath, formType, { sourceLanguage, targetLanguage }),
        processingTimeout,
      ]);
    } catch (aiError) {
      // Update the error message but keep status as failed
      await db.collection("bulletins").doc(bulletinId).update({
        "metadata.processingError": aiError.message,
        "metadata.lastModified": admin.firestore.FieldValue.serverTimestamp(),
        "metadata.lastRetryAt": new Date().toISOString(),
      });
      await cache.del(keys.userBulletins(userId));
      await cache.del(keys.bulletin(bulletinId));

      // Clean up temp file
      try { require("fs").unlinkSync(tempPath); } catch {}

      return res.status(206).json({
        success: false,
        error: aiError.message,
        message: "AI processing failed again. Please try later or contact support.",
      });
    }

    // Clean up temp file
    try { require("fs").unlinkSync(tempPath); } catch {}

    if (!extractionResult || !extractionResult.success) {
      await db.collection("bulletins").doc(bulletinId).update({
        "metadata.processingError": extractionResult?.error || "Processing returned no data",
        "metadata.lastModified": admin.firestore.FieldValue.serverTimestamp(),
        "metadata.lastRetryAt": new Date().toISOString(),
      });
      await cache.del(keys.userBulletins(userId));
      await cache.del(keys.bulletin(bulletinId));

      return res.status(206).json({
        success: false,
        error: extractionResult?.error || "Processing returned no data",
      });
    }

    // Clean data for Firestore
    const cleanDataForFirestore = (data, depth = 0, insideArray = false) => {
      if (data === null || data === undefined) return null;
      if (typeof data !== "object") return data;
      if (depth > 15) return JSON.stringify(data);
      if (Array.isArray(data)) {
        if (insideArray) {
          const obj = {};
          data.forEach((item, i) => { obj[String(i)] = cleanDataForFirestore(item, depth + 1, false); });
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

    const cleanedData = cleanDataForFirestore(extractionResult.data);

    // Update the bulletin with successful processing results
    await db.collection("bulletins").doc(bulletinId).update({
      originalData: cleanedData,
      editedData: cleanedData,
      "metadata.status": "processed",
      "metadata.processingError": admin.firestore.FieldValue.delete(),
      "metadata.isTimeout": admin.firestore.FieldValue.delete(),
      "metadata.lastModified": admin.firestore.FieldValue.serverTimestamp(),
      "metadata.lastRetryAt": new Date().toISOString(),
      "metadata.studentName":
        cleanedData?.studentName ||
        cleanedData?.academicInfo?.studentName ||
        "Unknown Student",
      versionCount: 1,
      currentVersion: 1,
    });

    // Create initial version
    await db
      .collection("bulletins")
      .doc(bulletinId)
      .collection("versions")
      .add({
        versionNumber: 1,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        data: cleanedData,
        changeType: "retry_processing",
        formType: formType,
        createdAt: new Date().toISOString(),
        userId: userId,
      });

    await cache.del(keys.userBulletins(userId));
    await cache.del(keys.bulletin(bulletinId));

    console.log(`✅ Retry processing succeeded for bulletin ${bulletinId}`);

    res.json({
      success: true,
      firestoreId: bulletinId,
      formType: formType,
      message: "Document processed successfully",
    });
  } catch (error) {
    console.error("❌ Retry processing failed:", error.message);
    res.status(500).json({ error: "Failed to retry processing", details: error.message });
  }
});

module.exports = router;

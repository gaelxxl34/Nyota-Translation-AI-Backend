// Document Verification Route (PUBLIC - no auth required)
// Allows anyone scanning a QR code to verify document authenticity
// Uses Firebase Admin SDK (bypasses Firestore security rules)

const express = require("express");
const admin = require("firebase-admin");
const { cache, TTL, keys } = require("../services/cache");
const router = express.Router();

/**
 * GET /api/verify/:documentId
 * Public endpoint - returns minimal verification data for a document
 */
router.get("/:documentId", async (req, res) => {
  try {
    const { documentId } = req.params;

    if (!documentId) {
      return res.status(400).json({ error: "Document ID is required" });
    }

    console.log(`🔍 Verification request for document: ${documentId}`);

    const verificationData = await cache.getOrSet(keys.verification(documentId), TTL.VERIFICATION, async () => {
      const db = admin.firestore();

      // Query the bulletins collection for a document where id field matches
      const bulletinsRef = db.collection("bulletins");
      const snapshot = await bulletinsRef
        .where("id", "==", documentId)
        .limit(1)
        .get();

      if (snapshot.empty) {
        console.log(`❌ No document found with ID: ${documentId}`);
        return null;
      }

      const bulletinDoc = snapshot.docs[0];
      const bulletinData = bulletinDoc.data();

      // Extract student name from various possible locations
      let studentName = "Unknown Student";

      // 1. Check editedData
      if (bulletinData.editedData?.studentName) {
        studentName = bulletinData.editedData.studentName;
      }
      // 2. Check versions subcollection
      else {
        try {
          const versionsSnapshot = await bulletinDoc.ref
            .collection("versions")
            .limit(1)
            .get();

          if (!versionsSnapshot.empty) {
            const versionData = versionsSnapshot.docs[0].data();

            if (versionData.data && Array.isArray(versionData.data)) {
              for (const item of versionData.data) {
                if (item.studentName) {
                  studentName = item.studentName;
                  break;
                }
              }
            } else if (versionData.data?.studentName) {
              studentName = versionData.data.studentName;
            }
          }
        } catch (versionsError) {
          console.error("⚠️ Error checking versions:", versionsError.message);
        }
      }

      // 3. Fallback fields
      if (studentName === "Unknown Student") {
        const fallbackFields = [
          "studentName",
          "student_name",
          "name",
          "Student Name",
        ];
        for (const field of fallbackFields) {
          if (bulletinData[field]) {
            studentName = bulletinData[field];
            break;
          }
        }
      }

      const result = {
        studentName,
        generationDate:
          bulletinData.createdAt ||
          bulletinData.uploadedAt ||
          bulletinData.metadata?.createdAt ||
          new Date().toISOString(),
        documentTitle:
          bulletinData.editedData?.documentTitle ||
          bulletinData.originalData?.documentTitle ||
          undefined,
        documentType:
          bulletinData.editedData?.documentType ||
          bulletinData.originalData?.documentType ||
          undefined,
        sourceLanguage:
          bulletinData.editedData?.sourceLanguage ||
          bulletinData.originalData?.sourceLanguage ||
          undefined,
        targetLanguage:
          bulletinData.editedData?.targetLanguage ||
          bulletinData.originalData?.targetLanguage ||
          bulletinData.metadata?.targetLanguage ||
          undefined,
        formType:
          bulletinData.metadata?.formType ||
          bulletinData.editedData?.formType ||
          undefined,
      };

      // For general documents, use documentTitle as fallback
      if (
        result.studentName === "Unknown Student" &&
        result.documentTitle
      ) {
        result.studentName = result.documentTitle;
      }

      return result;
    });

    if (!verificationData) {
      return res.status(404).json({ error: "Document not found" });
    }

    console.log(`✅ Verification successful for document: ${documentId}`);
    res.json(verificationData);
  } catch (error) {
    console.error("❌ Verification error:", error.message);
    res.status(500).json({ error: "Failed to verify document" });
  }
});

module.exports = router;

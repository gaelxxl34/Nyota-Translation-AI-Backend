// State Diploma temporary document creation endpoint
// This endpoint creates a temporary Firestore document for the State Diploma PDF generation

const express = require("express");
const admin = require("firebase-admin");
const { v4: uuidv4 } = require("uuid");
const router = express.Router();

// Initialize Firebase Admin if not already initialized
const { initializeFirebaseAdmin } = require("../auth");

// POST /api/create-temp-diploma - Create a temporary document for diploma PDF generation
router.post("/create-temp-diploma", async (req, res) => {
  try {
    console.log("🔄 Creating temporary diploma document...");
    console.log("📊 Received data:", JSON.stringify(req.body, null, 2));

    const { diplomaData, templateType = "stateDiploma" } = req.body;

    if (!diplomaData) {
      console.error("❌ No diploma data provided");
      return res.status(400).json({
        error: "Missing diploma data",
      });
    }

    // Initialize Firebase Admin
    initializeFirebaseAdmin();
    const db = admin.firestore();

    // Create a temporary ID for the document
    const tempId = `temp_diploma_${uuidv4()}`;

    // Store the data in Firestore
    await db
      .collection("temp_documents")
      .doc(tempId)
      .set({
        diplomaData,
        templateType,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        // Auto-delete after 1 hour (TTL implemented via Cloud Functions)
        expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
      });

    console.log("✅ Created temporary document with ID:", tempId);

    return res.status(201).json({
      success: true,
      tempId,
      message: "Temporary diploma document created successfully",
    });
  } catch (error) {
    console.error("❌ Error creating temporary document:", error);
    return res.status(500).json({
      error: "Failed to create temporary diploma document",
      details: error.message,
    });
  }
});

module.exports = router;

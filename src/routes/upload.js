// File Upload Routes for NTC
// Handles bulletin file uploads and processing

const express = require("express");
const { verifyToken } = require("../auth");
const { upload, handleMulterError } = require("../middleware/upload");

// Delayed configuration loading to ensure environment variables are available
let uploadAndExtract;
let isInitialized = false;

const initializeOpenAI = () => {
  if (isInitialized) return;

  const config = require("../config");

  // Choose OpenAI implementation based on configuration
  const openaiModule = config.openai.useMock
    ? require("../openai-mock")
    : require("../openai");

  uploadAndExtract = openaiModule.uploadAndExtract;

  console.log(
    `🤖 OpenAI Mode: ${
      config.openai.useMock ? "MOCK (Testing)" : "REAL (Production)"
    }`
  );
  isInitialized = true;
};

const router = express.Router();

/**
 * POST /api/upload
 * Upload bulletin file (image or PDF)
 * Requires authentication
 */
router.post("/", verifyToken, upload.single("file"), async (req, res) => {
  console.log(
    `📥 Upload request received from ${req.user?.email || "unknown user"}`
  );

  try {
    // Initialize OpenAI configuration if not already done
    initializeOpenAI();

    // Check if file was uploaded
    if (!req.file) {
      console.log(`❌ No file uploaded by ${req.user?.email}`);
      return res.status(400).json({
        error: "No file uploaded",
        details: "Please select a file to upload",
        code: "NO_FILE",
      });
    }

    console.log(`📤 File uploaded by ${req.user.email}:`);
    console.log(`  - Original name: ${req.file.originalname}`);
    console.log(`  - Saved as: ${req.file.filename}`);
    console.log(`  - Size: ${req.file.size} bytes`);
    console.log(`  - MIME type: ${req.file.mimetype}`);
    console.log(`  - Path: ${req.file.path}`);

    try {
      // Process the file with OpenAI
      console.log(`🤖 Starting OpenAI processing for ${req.file.filename}...`);
      const extractionResult = await uploadAndExtract(req.file.path);

      console.log(`✅ OpenAI processing completed for ${req.user.email}`);

      // Save OpenAI results to Firestore
      let firestoreDocId = null;
      try {
        const admin = require("firebase-admin");
        const db = admin.firestore();

        // Generate bulletin document ID
        firestoreDocId = `bulletin_${req.user.uid}_${Date.now()}`;

        // Create bulletin document in Firestore with proper structure
        const bulletinDoc = {
          id: firestoreDocId,
          userId: req.user.uid,
          userEmail: req.user.email,
          originalData: extractionResult.success ? extractionResult.data : null,
          editedData: extractionResult.success ? extractionResult.data : null,
          metadata: {
            uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastModified: admin.firestore.FieldValue.serverTimestamp(),
            fileName: req.file.originalname,
            fileSize: req.file.size,
            filePath: req.file.path,
            status: extractionResult.success ? "processed" : "failed",
            studentName: extractionResult.success
              ? extractionResult.data?.studentName
              : null,
            createdAt: new Date().toISOString(),
            lastModifiedAt: new Date().toISOString(),
          },
          // Move versions to a separate subcollection to avoid array limitations
          versionCount: 1,
          currentVersion: 1,
          tags: [], // For categorization
          isActive: true,
        };

        // Save the main bulletin document
        await db.collection("bulletins").doc(firestoreDocId).set(bulletinDoc);

        // Create initial version in subcollection (avoids array timestamp issues)
        if (extractionResult.success) {
          await db
            .collection("bulletins")
            .doc(firestoreDocId)
            .collection("versions")
            .add({
              versionNumber: 1,
              timestamp: admin.firestore.FieldValue.serverTimestamp(),
              data: extractionResult.data,
              changeType: "initial_upload",
              createdAt: new Date().toISOString(),
              userId: req.user.uid,
            });
        }

        console.log(`✅ Saved OpenAI results to Firestore: ${firestoreDocId}`);
      } catch (firestoreError) {
        console.warn(
          `⚠️ Failed to save to Firestore: ${firestoreError.message}`
        );
        console.error("Firestore error details:", firestoreError);
      }

      // Return the extracted and translated data
      res.status(200).json({
        message: "File uploaded and processed successfully",
        file: {
          filename: req.file.filename,
          originalName: req.file.originalname,
          path: req.file.path,
          size: req.file.size,
          mimetype: req.file.mimetype,
        },
        user: {
          uid: req.user.uid,
          email: req.user.email,
        },
        processing: {
          ...extractionResult,
          firestoreId: firestoreDocId, // Include Firestore document ID
        },
        firestoreId: firestoreDocId, // Also include at top level for easy access
        timestamp: new Date().toISOString(),
      });
    } catch (openaiError) {
      console.error(
        `🚨 OpenAI processing failed for ${req.user.email}:`,
        openaiError.message
      );

      // Return partial success - file uploaded but processing failed
      res.status(206).json({
        message: "File uploaded successfully, but processing failed",
        file: {
          filename: req.file.filename,
          originalName: req.file.originalname,
          path: req.file.path,
          size: req.file.size,
          mimetype: req.file.mimetype,
        },
        user: {
          uid: req.user.uid,
          email: req.user.email,
        },
        processing: {
          success: false,
          error: openaiError.message,
          details:
            "The file was uploaded successfully but could not be processed by AI. This might be due to API issues or invalid file content.",
        },
        timestamp: new Date().toISOString(),
      });
    }

    // TODO: Add OpenAI processing in next phase
    // TODO: Store metadata in Firestore
    // TODO: Generate translation results
  } catch (error) {
    console.error("🚨 Upload processing failed:", error.message);
    console.error("🚨 Stack trace:", error.stack);

    // Ensure we always return a JSON response
    if (!res.headersSent) {
      res.status(500).json({
        error: "Failed to process file upload",
        details: error.message,
        code: "PROCESSING_ERROR",
        timestamp: new Date().toISOString(),
      });
    }
  }
});

// Apply multer error handling middleware
router.use(handleMulterError);

/**
 * GET /api/upload/status/:id
 * Check processing status of uploaded bulletin
 */
router.get("/status/:id", verifyToken, async (req, res) => {
  try {
    // TODO: Implement status checking
    // Query Firestore for processing status
    // Return current status and results if complete

    console.log("📊 Status check endpoint - Not implemented yet");

    res.status(200).json({
      message: "Status check endpoint ready",
      bulletinId: req.params.id,
    });
  } catch (error) {
    console.error("🚨 Status check failed:", error.message);
    res.status(500).json({ error: "Failed to check status" });
  }
});

module.exports = router;

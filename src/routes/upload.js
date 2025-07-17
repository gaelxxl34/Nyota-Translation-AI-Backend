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

    // Extract and validate form type from request body
    let formType = req.body.formType || "form6"; // Default to form6 for backwards compatibility

    // Validate form type
    if (!["form4", "form6", "stateDiploma"].includes(formType)) {
      console.warn(
        `⚠️ Invalid form type received: ${formType}, defaulting to form6`
      );
      formType = "form6";
    }

    console.log(`  - Form type: ${formType}`);

    try {
      // Process the file with OpenAI
      console.log(`🤖 Starting OpenAI processing for ${req.file.filename}...`);
      const extractionResult = await uploadAndExtract(req.file.path, formType); // Pass form type to processing

      console.log(`✅ OpenAI processing completed for ${req.user.email}`);

      // Save OpenAI results to Firestore
      let firestoreDocId = null;
      try {
        const admin = require("firebase-admin");
        const db = admin.firestore();

        // Generate bulletin document ID
        firestoreDocId = `bulletin_${req.user.uid}_${Date.now()}`;

        // Clean data to remove undefined values for Firestore
        const cleanDataForFirestore = (data) => {
          if (data === null || data === undefined) return null;
          if (typeof data !== "object") return data;
          if (Array.isArray(data))
            return data.map((item) => cleanDataForFirestore(item));

          const cleaned = {};
          for (const [key, value] of Object.entries(data)) {
            if (value !== undefined) {
              cleaned[key] = cleanDataForFirestore(value);
            }
          }
          return cleaned;
        };

        const cleanedData = extractionResult.success
          ? cleanDataForFirestore(extractionResult.data)
          : null;

        // Create bulletin document in Firestore with proper structure
        const bulletinDoc = {
          id: firestoreDocId,
          userId: req.user.uid,
          userEmail: req.user.email,
          originalData: cleanedData,
          editedData: cleanedData,
          metadata: {
            uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastModified: admin.firestore.FieldValue.serverTimestamp(),
            fileName: req.file.originalname,
            fileSize: req.file.size,
            filePath: req.file.path,
            status: extractionResult.success ? "processed" : "failed",
            formType: formType, // Add form type to metadata
            studentName: extractionResult.success
              ? cleanedData?.studentName
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

        console.log(`✅ Saved bulletin document with form type: ${formType}`);
        console.log(`📊 Document ID: ${firestoreDocId}`);
        console.log(`📋 Form Type: ${formType}`);
        console.log(
          `👤 Student: ${
            extractionResult.success
              ? extractionResult.data?.studentName
              : "N/A"
          }`
        );

        // Create initial version in subcollection (avoids array timestamp issues)
        if (extractionResult.success && cleanedData) {
          await db
            .collection("bulletins")
            .doc(firestoreDocId)
            .collection("versions")
            .add({
              versionNumber: 1,
              timestamp: admin.firestore.FieldValue.serverTimestamp(),
              data: cleanedData,
              changeType: "initial_upload",
              formType: formType, // Include form type in version tracking
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
          formType: formType, // Include form type in file metadata
        },
        user: {
          uid: req.user.uid,
          email: req.user.email,
        },
        processing: {
          ...extractionResult,
          firestoreId: firestoreDocId, // Include Firestore document ID
          formType: formType, // Include form type in processing results
        },
        firestoreId: firestoreDocId, // Also include at top level for easy access
        formType: formType, // Include form type at top level for easy access
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
          formType: formType, // Include form type even in error response
        },
        user: {
          uid: req.user.uid,
          email: req.user.email,
        },
        processing: {
          success: false,
          error: openaiError.message,
          formType: formType, // Include form type in processing error
          details:
            "The file was uploaded successfully but could not be processed by AI. This might be due to API issues or invalid file content.",
        },
        formType: formType, // Include form type at top level
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

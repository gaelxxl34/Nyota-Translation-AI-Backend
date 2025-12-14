// File Upload Routes for NTC
// Handles bulletin file uploads and processing

const express = require("express");
const { verifyToken } = require("../auth");
const { upload, handleMulterError } = require("../middleware/upload");
const {
  uploadToStorage,
  deleteLocalFile,
  generateStoragePath,
} = require("../services/storage");

// Delayed configuration loading to ensure environment variables are available
let processDocument;
let isInitialized = false;

const initializeAI = () => {
  if (isInitialized) return;

  // Use AI Router for smart routing (Claude for bulletins, OpenAI for diplomas/attestations)
  const aiRouter = require("../ai-router");
  processDocument = aiRouter.processDocument;

  console.log(
    `🤖 AI System: ROUTER (Claude for bulletins, OpenAI for diplomas/attestations)`
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
    // Initialize AI configuration if not already done
    initializeAI();

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

    // Validate form type - now supporting all 8 document types
    const validFormTypes = [
      "form4",
      "form6",
      "collegeTranscript",
      "collegeAttestation",
      "stateDiploma",
      "bachelorDiploma",
      "highSchoolAttestation",
      "stateExamAttestation",
    ];
    if (!validFormTypes.includes(formType)) {
      console.warn(
        `⚠️ Invalid form type received: ${formType}, defaulting to form6`
      );
      formType = "form6";
    }

    console.log(`  - Form type: ${formType}`);

    try {
      // Process the file with AI (routes to appropriate provider)
      console.log(`🤖 Starting AI processing for ${req.file.filename}...`);

      // Add timeout wrapper for AI processing
      const processingTimeout = new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("AI processing timeout after 4 minutes")),
          240000
        );
      });

      const extractionResult = await Promise.race([
        processDocument(req.file.path, formType),
        processingTimeout,
      ]);

      console.log(`✅ AI processing completed for ${req.user.email}`);

      // POST-PROCESSING: Override specific fields for college transcripts to ensure English fixed values
      if (
        formType === "collegeTranscript" &&
        extractionResult.success &&
        extractionResult.data
      ) {
        console.log(
          `🔧 Applying fixed English values for college transcript...`
        );

        // Override country to uppercase English
        extractionResult.data.country = "DEMOCRATIC REPUBLIC OF THE CONGO";

        // Override institution type to English
        extractionResult.data.institutionType =
          "HIGHER EDUCATION AND UNIVERSITY";

        // Override document title to fixed English (not editable)
        extractionResult.data.documentTitle =
          "TRANSCRIPT OF SUBJECTS AND GRADES";

        // Override department name to fixed English (not editable)
        extractionResult.data.departmentName = "Academic Services";

        console.log(`✅ Fixed English values applied to college transcript`);
      }

      // Upload file to Firebase Storage
      let storageResult = { success: false };
      try {
        const storagePath = generateStoragePath(
          req.user.uid,
          formType,
          req.file.originalname
        );

        storageResult = await uploadToStorage(req.file.path, storagePath, {
          contentType: req.file.mimetype,
          originalName: req.file.originalname,
          userId: req.user.uid,
          formType: formType,
        });

        if (storageResult.success) {
          console.log(
            `☁️ File uploaded to Firebase Storage: ${storageResult.storagePath}`
          );
        } else {
          console.warn(
            `⚠️ Failed to upload to Firebase Storage: ${storageResult.error}`
          );
        }
      } catch (storageError) {
        console.warn(
          `⚠️ Firebase Storage upload error: ${storageError.message}`
        );
      }

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
            // Firebase Storage info (preferred) with local fallback
            storageUrl: storageResult.success ? storageResult.url : null,
            storagePath: storageResult.success
              ? storageResult.storagePath
              : null,
            storageBucket: storageResult.success ? storageResult.bucket : null,
            localFilePath: req.file.path, // Keep for fallback/debugging
            status: extractionResult.success ? "processed" : "failed",
            formType: formType, // Add form type to metadata
            studentName:
              extractionResult.success && cleanedData?.studentName
                ? cleanedData.studentName
                : "Unknown Student",
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

      // Clean up local file after successful Firebase Storage upload
      if (storageResult.success) {
        try {
          await deleteLocalFile(req.file.path);
          console.log(`🧹 Local file cleaned up after successful cloud upload`);
        } catch (cleanupError) {
          console.warn(
            `⚠️ Failed to clean up local file: ${cleanupError.message}`
          );
        }
      }

      // Return the extracted and translated data
      res.status(200).json({
        message: "File uploaded and processed successfully",
        file: {
          filename: req.file.filename,
          originalName: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype,
          formType: formType,
          // Include storage info in response
          storageUrl: storageResult.success ? storageResult.url : null,
          storagePath: storageResult.success ? storageResult.storagePath : null,
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
        `🚨 AI processing failed for ${req.user.email}:`,
        openaiError.message
      );

      // Determine if this is a timeout error
      const isTimeout =
        openaiError.message.includes("timeout") ||
        openaiError.message.includes("Timeout") ||
        openaiError.code === "ETIMEDOUT";

      const statusCode = isTimeout ? 408 : 206; // 408 for timeout, 206 for partial success

      // Still try to upload file to storage even if AI processing failed
      let errorStorageResult = { success: false };
      try {
        const storagePath = generateStoragePath(
          req.user.uid,
          formType,
          req.file.originalname
        );
        errorStorageResult = await uploadToStorage(req.file.path, storagePath, {
          contentType: req.file.mimetype,
          originalName: req.file.originalname,
          userId: req.user.uid,
          formType: formType,
        });
        if (errorStorageResult.success) {
          await deleteLocalFile(req.file.path);
        }
      } catch (storageErr) {
        console.warn(
          `⚠️ Storage upload failed during error handling: ${storageErr.message}`
        );
      }

      // Return appropriate error response
      res.status(statusCode).json({
        message: isTimeout
          ? "Processing timed out. Please try again with a smaller file or simpler document."
          : "File uploaded successfully, but processing failed",
        file: {
          filename: req.file.filename,
          originalName: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype,
          formType: formType,
          storageUrl: errorStorageResult.success
            ? errorStorageResult.url
            : null,
          storagePath: errorStorageResult.success
            ? errorStorageResult.storagePath
            : null,
        },
        user: {
          uid: req.user.uid,
          email: req.user.email,
        },
        processing: {
          success: false,
          error: openaiError.message,
          formType: formType, // Include form type in processing error
          isTimeout: isTimeout,
          details: isTimeout
            ? "The document processing took too long. This might be due to a complex document or temporary API issues. Please try again with a smaller or simpler document."
            : "The file was uploaded successfully but could not be processed by AI. This might be due to API issues or invalid file content.",
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

module.exports = router;

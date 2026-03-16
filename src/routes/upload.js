// File Upload Routes for NTC
// Handles document file uploads and AI processing

const express = require("express");
const { verifyToken } = require("../auth");
const { upload, handleMulterError } = require("../middleware/upload");
const {
  uploadToStorage,
  deleteFromStorage,
  deleteLocalFile,
  generateStoragePath,
} = require("../services/storage");
const { VALID_FORM_TYPES } = require("../config/documentTypes");
const { cache, keys } = require("../services/cache");

// Delayed configuration loading to ensure environment variables are available
let processDocument;
let isInitialized = false;

const initializeAI = () => {
  if (isInitialized) return;

  // Use AI Router for smart routing (Claude for bulletins, OpenAI for diplomas/attestations)
  const aiRouter = require("../ai-router");
  processDocument = aiRouter.processDocument;

  console.log(
    `🤖 AI System: ROUTER (Claude for bulletins, OpenAI for diplomas/attestations/general)`,
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
    `📥 Upload request received from ${req.user?.email || "unknown user"}`,
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

    // Validate form type using centralized config
    if (!VALID_FORM_TYPES.includes(formType)) {
      console.warn(
        `⚠️ Invalid form type received: ${formType}, defaulting to form6`,
      );
      formType = "form6";
    }

    console.log(`  - Form type: ${formType}`);

    // Extract source and target language
    const sourceLanguage = req.body.sourceLanguage || "auto";
    const targetLanguage = req.body.targetLanguage || "english";
    if (formType === "generalDocument") {
      console.log(`  - Source language: ${sourceLanguage}`);
      console.log(`  - Target language: ${targetLanguage}`);
    }

    try {
      // Process the file with AI (routes to appropriate provider)
      console.log(`🤖 Starting AI processing for ${req.file.filename}...`);

      // Add timeout wrapper for AI processing
      const processingTimeout = new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("AI processing timeout after 4 minutes")),
          240000,
        );
      });

      const extractionResult = await Promise.race([
        processDocument(req.file.path, formType, { sourceLanguage, targetLanguage }),
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
          `🔧 Applying fixed English values for college transcript...`,
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
          req.file.originalname,
        );

        storageResult = await uploadToStorage(req.file.path, storagePath, {
          contentType: req.file.mimetype,
          originalName: req.file.originalname,
          userId: req.user.uid,
          formType: formType,
        });

        if (storageResult.success) {
          console.log(
            `☁️ File uploaded to Firebase Storage: ${storageResult.storagePath}`,
          );
        } else {
          console.warn(
            `⚠️ Failed to upload to Firebase Storage: ${storageResult.error}`,
          );
        }
      } catch (storageError) {
        console.warn(
          `⚠️ Firebase Storage upload error: ${storageError.message}`,
        );
      }

      // Save OpenAI results to Firestore
      let firestoreDocId = null;
      try {
        const admin = require("firebase-admin");
        const db = admin.firestore();

        // Generate bulletin document ID
        firestoreDocId = `bulletin_${req.user.uid}_${Date.now()}`;

        // Clean data for Firestore: remove undefined, cap depth, convert nested arrays
        // Firestore does NOT allow arrays within arrays, so we convert inner arrays to maps
        const cleanDataForFirestore = (data, depth = 0, insideArray = false) => {
          if (data === null || data === undefined) return null;
          if (typeof data !== "object") return data;
          // Firestore has a 20-level nesting limit; stringify anything deeper than 15
          if (depth > 15) return JSON.stringify(data);

          if (Array.isArray(data)) {
            if (insideArray) {
              // Firestore forbids nested arrays — convert inner array to a map with index keys
              const obj = {};
              data.forEach((item, i) => {
                obj[String(i)] = cleanDataForFirestore(item, depth + 1, false);
              });
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

        const cleanedData = extractionResult.success
          ? cleanDataForFirestore(extractionResult.data)
          : null;

        // Create bulletin document in Firestore with proper structure
        const bulletinDoc = {
          id: firestoreDocId,
          userId: req.user.uid,
          userEmail: req.user.email,
          formType: formType, // Top-level formType for easy access
          sourceLanguage: sourceLanguage, // Top-level sourceLanguage for easy access
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
            sourceLanguage: sourceLanguage,
            targetLanguage:
              formType === "generalDocument" ? targetLanguage : null,
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

        // Invalidate user's bulletin list cache
        await cache.del(keys.userBulletins(req.user.uid));

        console.log(`✅ Saved bulletin document with form type: ${formType}`);
        console.log(`📊 Document ID: ${firestoreDocId}`);
        console.log(`📋 Form Type: ${formType}`);
        console.log(
          `👤 Student: ${
            extractionResult.success
              ? extractionResult.data?.studentName
              : "N/A"
          }`,
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
          `⚠️ Failed to save to Firestore: ${firestoreError.message}`,
        );
        console.error("Firestore error details:", firestoreError);

        // Clean up orphaned Storage file if Firestore save failed
        if (storageResult.success && storageResult.storagePath) {
          try {
            await deleteFromStorage(storageResult.storagePath);
            console.log(`🧹 Cleaned up orphaned Storage file: ${storageResult.storagePath}`);
          } catch (cleanupErr) {
            console.warn(`⚠️ Failed to clean up orphaned Storage file: ${cleanupErr.message}`);
          }
        }
      }

      // Always clean up local file after processing (regardless of Storage/Firestore success)
      try {
        await deleteLocalFile(req.file.path);
        console.log(`🧹 Local file deleted: ${req.file.path}`);
      } catch (cleanupError) {
        console.warn(
          `⚠️ Failed to clean up local file: ${cleanupError.message}`,
        );
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
        openaiError.message,
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
          req.file.originalname,
        );
        errorStorageResult = await uploadToStorage(req.file.path, storagePath, {
          contentType: req.file.mimetype,
          originalName: req.file.originalname,
          userId: req.user.uid,
          formType: formType,
        });
      } catch (storageErr) {
        console.warn(
          `⚠️ Storage upload failed during error handling: ${storageErr.message}`,
        );
      }

      // Always clean up local file
      try {
        await deleteLocalFile(req.file.path);
        console.log(`🧹 Local file deleted after error: ${req.file.path}`);
      } catch (cleanupErr) {
        console.warn(`⚠️ Failed to clean up local file: ${cleanupErr.message}`);
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

    // Always clean up local file on total failure
    if (req.file?.path) {
      try {
        await deleteLocalFile(req.file.path);
        console.log(`🧹 Local file deleted after failure: ${req.file.path}`);
      } catch (cleanupErr) {
        console.warn(`⚠️ Cleanup failed: ${cleanupErr.message}`);
      }
    }

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
 * POST /api/upload/multi
 * Upload multiple images/pages for a generalDocument
 * Processes each file through AI, merges all extracted pages into one document
 * Saves the combined result to Firestore
 */
router.post(
  "/multi",
  verifyToken,
  upload.array("files", 20),
  async (req, res) => {
    console.log(
      `📥 Multi-upload request from ${req.user?.email || "unknown"} — ${req.files?.length || 0} files`,
    );

    try {
      initializeAI();

      if (!req.files || req.files.length === 0) {
        return res
          .status(400)
          .json({ error: "No files uploaded", code: "NO_FILE" });
      }

      const targetLanguage = req.body.targetLanguage || "english";
      const formType = "generalDocument";

      console.log(`  - Files: ${req.files.length}`);
      console.log(`  - Target language: ${targetLanguage}`);

      // Process each file sequentially through AI and collect pages
      const allPages = [];
      let combinedTitle = null;
      let combinedType = null;
      let combinedSubtitle = null;
      let combinedAuthor = null;
      let combinedOrganization = null;
      let combinedDate = null;
      let combinedSourceLanguage = null;

      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        console.log(
          `  📄 Processing file ${i + 1}/${req.files.length}: ${file.originalname}`,
        );

        try {
          const processingTimeout = new Promise((_, reject) => {
            setTimeout(
              () =>
                reject(
                  new Error(
                    `AI processing timeout for file ${i + 1} after 4 minutes`,
                  ),
                ),
              240000,
            );
          });

          const extractionResult = await Promise.race([
            processDocument(file.path, formType, { targetLanguage }),
            processingTimeout,
          ]);

          if (extractionResult.success && extractionResult.data) {
            const data = extractionResult.data;

            // Use metadata from first successfully processed file
            if (!combinedTitle && data.documentTitle)
              combinedTitle = data.documentTitle;
            if (!combinedType && data.documentType)
              combinedType = data.documentType;
            if (!combinedSubtitle && data.documentSubtitle)
              combinedSubtitle = data.documentSubtitle;
            if (!combinedAuthor && data.author) combinedAuthor = data.author;
            if (!combinedOrganization && data.organization)
              combinedOrganization = data.organization;
            if (!combinedDate && data.date) combinedDate = data.date;
            if (!combinedSourceLanguage && data.sourceLanguage)
              combinedSourceLanguage = data.sourceLanguage;

            // Collect pages with sequential numbering
            if (data.pages && data.pages.length > 0) {
              for (const page of data.pages) {
                allPages.push({
                  ...page,
                  pageNumber: allPages.length + 1,
                });
              }
            }

            console.log(
              `  ✅ File ${i + 1}: extracted ${data.pages?.length || 0} page(s)`,
            );
          } else {
            console.warn(
              `  ⚠️ File ${i + 1}: extraction failed or returned no data`,
            );
          }
        } catch (fileError) {
          console.error(
            `  ❌ File ${i + 1} processing error: ${fileError.message}`,
          );
          // Continue with remaining files
        }
      }

      if (allPages.length === 0) {
        // Clean up all files
        for (const file of req.files) {
          deleteLocalFile(file.path);
        }
        return res.status(422).json({
          error: "Failed to extract content from any uploaded file",
          code: "EXTRACTION_FAILED",
        });
      }

      // Build the combined extraction result
      const combinedData = {
        documentTitle: combinedTitle || "Translated Document",
        documentSubtitle: combinedSubtitle || null,
        documentType: combinedType || "General Document",
        sourceLanguage: combinedSourceLanguage || null,
        targetLanguage: targetLanguage,
        author: combinedAuthor || null,
        organization: combinedOrganization || null,
        date: combinedDate || null,
        pages: allPages,
        totalPages: allPages.length,
        formType: formType,
      };

      const extractionResult = {
        success: true,
        data: combinedData,
      };

      console.log(
        `✅ Multi-upload AI processing complete: ${allPages.length} total pages from ${req.files.length} files`,
      );

      // Upload first file to Firebase Storage as representative
      let storageResult = { success: false };
      try {
        const storagePath = generateStoragePath(
          req.user.uid,
          formType,
          req.files[0].originalname,
        );

        storageResult = await uploadToStorage(req.files[0].path, storagePath, {
          contentType: req.files[0].mimetype,
          originalName: req.files[0].originalname,
          userId: req.user.uid,
          formType: formType,
        });

        if (storageResult.success) {
          console.log(
            `☁️ File uploaded to Firebase Storage: ${storageResult.storagePath}`,
          );
        }
      } catch (storageError) {
        console.warn(
          `⚠️ Firebase Storage upload error: ${storageError.message}`,
        );
      }

      // Save combined results to Firestore
      let firestoreDocId = null;
      try {
        const admin = require("firebase-admin");
        const db = admin.firestore();

        firestoreDocId = `bulletin_${req.user.uid}_${Date.now()}`;

        // Clean data to remove undefined values
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

        const cleanedData = cleanDataForFirestore(combinedData);

        const bulletinDoc = {
          id: firestoreDocId,
          userId: req.user.uid,
          userEmail: req.user.email,
          originalData: cleanedData,
          editedData: cleanedData,
          metadata: {
            uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastModified: admin.firestore.FieldValue.serverTimestamp(),
            fileName: req.files.map((f) => f.originalname).join(", "),
            fileSize: req.files.reduce((sum, f) => sum + f.size, 0),
            fileCount: req.files.length,
            storageUrl: storageResult.success ? storageResult.url : null,
            storagePath: storageResult.success
              ? storageResult.storagePath
              : null,
            storageBucket: storageResult.success ? storageResult.bucket : null,
            status: "processed",
            formType: formType,
            targetLanguage: targetLanguage,
            studentName: combinedTitle || "General Document",
            createdAt: new Date().toISOString(),
            lastModifiedAt: new Date().toISOString(),
          },
          versionCount: 1,
          currentVersion: 1,
          tags: [],
          isActive: true,
        };

        await db.collection("bulletins").doc(firestoreDocId).set(bulletinDoc);

        // Invalidate user's bulletin list cache
        await cache.del(keys.userBulletins(req.user.uid));

        if (cleanedData) {
          await db
            .collection("bulletins")
            .doc(firestoreDocId)
            .collection("versions")
            .add({
              versionNumber: 1,
              timestamp: admin.firestore.FieldValue.serverTimestamp(),
              data: cleanedData,
              changeType: "initial_upload",
              formType: formType,
              createdAt: new Date().toISOString(),
              userId: req.user.uid,
            });
        }

        console.log(
          `✅ Saved multi-upload document to Firestore: ${firestoreDocId}`,
        );
      } catch (firestoreError) {
        console.warn(
          `⚠️ Failed to save to Firestore: ${firestoreError.message}`,
        );
      }

      // Clean up all local files
      for (const file of req.files) {
        try {
          await deleteLocalFile(file.path);
        } catch (cleanupError) {
          console.warn(`⚠️ Cleanup failed for ${file.originalname}`);
        }
      }

      res.status(200).json({
        message: "Files uploaded and processed successfully",
        file: {
          fileCount: req.files.length,
          filenames: req.files.map((f) => f.originalname),
          totalSize: req.files.reduce((sum, f) => sum + f.size, 0),
          formType: formType,
          storageUrl: storageResult.success ? storageResult.url : null,
          storagePath: storageResult.success ? storageResult.storagePath : null,
        },
        user: {
          uid: req.user.uid,
          email: req.user.email,
        },
        processing: {
          ...extractionResult,
          firestoreId: firestoreDocId,
          formType: formType,
          totalPages: allPages.length,
        },
        firestoreId: firestoreDocId,
        formType: formType,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("🚨 Multi-upload processing failed:", error.message);

      // Clean up all files on error
      if (req.files) {
        for (const file of req.files) {
          deleteLocalFile(file.path);
        }
      }

      if (!res.headersSent) {
        res.status(500).json({
          error: "Failed to process multi-file upload",
          details: error.message,
          code: "PROCESSING_ERROR",
        });
      }
    }
  },
);

/**
 * POST /api/upload/extract-page
 * Extract content from an uploaded image/screenshot using AI
 * Returns structured blocks without saving to Firestore
 * Used to append additional pages to an existing generalDocument
 */
router.post(
  "/extract-page",
  verifyToken,
  upload.single("file"),
  async (req, res) => {
    console.log(`📸 Extract-page request from ${req.user?.email || "unknown"}`);

    try {
      initializeAI();

      if (!req.file) {
        return res
          .status(400)
          .json({ error: "No file uploaded", code: "NO_FILE" });
      }

      const targetLanguage = req.body.targetLanguage || "english";
      console.log(`  - File: ${req.file.originalname} (${req.file.mimetype})`);
      console.log(`  - Target language: ${targetLanguage}`);

      // Process image with AI as generalDocument
      const processingTimeout = new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("AI processing timeout after 4 minutes")),
          240000,
        );
      });

      const extractionResult = await Promise.race([
        processDocument(req.file.path, "generalDocument", { targetLanguage }),
        processingTimeout,
      ]);

      // Clean up the uploaded file
      deleteLocalFile(req.file.path);

      if (!extractionResult.success || !extractionResult.data) {
        return res.status(422).json({
          error: "Failed to extract content from image",
          code: "EXTRACTION_FAILED",
        });
      }

      // Return just the extracted pages/blocks
      const data = extractionResult.data;
      res.status(200).json({
        success: true,
        pages: data.pages || [],
        documentTitle: data.documentTitle || null,
        documentType: data.documentType || null,
      });
    } catch (error) {
      console.error("🚨 Extract-page failed:", error.message);
      // Clean up file on error
      if (req.file) deleteLocalFile(req.file.path);
      res.status(500).json({
        error: "Failed to extract page content",
        details: error.message,
        code: "PROCESSING_ERROR",
      });
    }
  },
);

module.exports = router;

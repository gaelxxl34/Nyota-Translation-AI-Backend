// Certification Routes for NTC
// Handles document submission, review queue, certification, and verification

const express = require("express");
const fs = require("fs");
const admin = require("firebase-admin");
const { verifyToken } = require("../auth");
const { requireRole, ROLES } = require("../middleware/rbac");
const {
  uploadBufferToStorage,
  uploadToStorage,
  getSignedUrl,
  generateStoragePath,
} = require("../services/storage");
const { upload } = require("../middleware/upload");
const {
  verifyDocumentHash,
  isValidCertificationId,
} = require("../constants");
const certService = require("../services/certifiedDocuments");
const notifications = require("../services/notificationService");
const config = require("../config/env");
const { cache, TTL, keys } = require("../services/cache");

const router = express.Router();

// ============================================
// USER ENDPOINTS
// ============================================

// POST /api/certification/create — create a certified document entry from an upload
router.post("/create", verifyToken, async (req, res) => {
  try {
    const { firestoreId, formType, sourceLanguage, originalData, storageUrl, storagePath, fileName, fileSize } = req.body;

    if (!originalData) {
      return res.status(400).json({ error: "originalData is required" });
    }

    // Resolve formType: use provided value, or look up from bulletin doc
    let resolvedFormType = formType;
    if (!resolvedFormType && firestoreId) {
      const bulletinSnap = await admin.firestore().collection("bulletins").doc(firestoreId).get();
      if (bulletinSnap.exists) {
        const bulletinData = bulletinSnap.data();
        resolvedFormType = bulletinData.formType || bulletinData.metadata?.formType;
      }
    }

    const result = await certService.createSubmission({
      userId: req.user.uid,
      userEmail: req.user.email,
      formType: resolvedFormType || "generalDocument",
      sourceLanguage: sourceLanguage || "auto",
      targetLanguage: "en",
      originalData,
      storageUrl: storageUrl || null,
      storagePath: storagePath || null,
      storageBucket: null,
      fileName: fileName || "document",
      fileSize: fileSize || 0,
      bulletinId: firestoreId || null,
    });

    res.json({ success: true, ...result });
  } catch (error) {
    console.error("🚨 Create certified doc error:", error.message);
    res.status(500).json({ error: "Failed to create submission" });
  }
});

// GET /api/certification/my-documents — list user's certified documents
router.get("/my-documents", verifyToken, async (req, res) => {
  try {
    const { status } = req.query;
    const docs = await certService.getUserDocuments(req.user.uid, status || null);
    res.json({ success: true, documents: docs });
  } catch (error) {
    console.error("🚨 Error fetching user documents:", error.message);
    res.status(500).json({ error: "Failed to fetch documents" });
  }
});
// GET /api/certification/check-bulletin/:bulletinId — check if a bulletin has an active submission
router.get("/check-bulletin/:bulletinId", verifyToken, async (req, res) => {
  try {
    const { bulletinId } = req.params;
    const cacheKey = keys.bulletinCheck(bulletinId, req.user.uid);
    const result = await cache.getOrSet(cacheKey, TTL.DOCUMENT, async () => {
      const db = admin.firestore();
      const snap = await db
        .collection("certifiedDocuments")
        .where("bulletinId", "==", bulletinId)
        .where("userId", "==", req.user.uid)
        .where("isActive", "==", true)
        .limit(1)
        .get();

      if (snap.empty) {
        return { hasSubmission: false };
      }

      const doc = snap.docs[0].data();
      return {
        hasSubmission: true,
        submission: {
          id: doc.id,
          status: doc.status,
          certificationId: doc.certification?.certificationId || null,
          rejectionReason: doc.review?.rejectionReason || null,
          rejectionType: doc.review?.rejectionType || null,
        },
      };
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("\ud83d\udea8 Check bulletin error:", error.message);
    res.status(500).json({ error: "Failed to check bulletin status" });
  }
});
// GET /api/certification/document/:docId — get single document
router.get("/document/:docId", verifyToken, async (req, res) => {
  try {
    const doc = await certService.getDocument(req.params.docId);
    if (!doc) return res.status(404).json({ error: "Document not found" });

    // Users can only view their own; staff can view all
    const userRole = req.user.role || "user";
    const isStaff = [ROLES.TRANSLATOR, ROLES.SUPER_ADMIN, ROLES.SUPPORT].includes(userRole);
    if (doc.userId !== req.user.uid && !isStaff) {
      return res.status(403).json({ error: "Not authorized" });
    }

    res.json({ success: true, document: doc });
  } catch (error) {
    console.error("🚨 Error fetching document:", error.message);
    res.status(500).json({ error: "Failed to fetch document" });
  }
});

// POST /api/certification/submit/:docId — submit for review (draft → pending_review)
router.post("/submit/:docId", verifyToken, async (req, res) => {
  try {
    const { speedTier } = req.body;
    if (!speedTier) {
      return res.status(400).json({ error: "Speed tier is required" });
    }

    const result = await certService.submitForReview(
      req.params.docId,
      req.user.uid,
      speedTier
    );

    // Fire submission notifications (async, non-blocking)
    const doc = await certService.getDocument(req.params.docId);
    if (doc) {
      notifications.onDocumentSubmitted(doc).catch((err) => console.error("⚠️ Submission notification failed:", err.message));
    } else {
      console.warn("⚠️ Could not find document for submission notification:", req.params.docId);
    }

    res.json({ success: true, ...result });
  } catch (error) {
    console.error("🚨 Submission error:", error.message);
    const status = error.message.includes("Not authorized") ? 403
      : error.message.includes("not found") ? 404
      : 400;
    res.status(status).json({ error: error.message });
  }
});

// POST /api/certification/cancel/:docId — cancel a document
router.post("/cancel/:docId", verifyToken, async (req, res) => {
  try {
    const result = await certService.cancelDocument(req.params.docId, req.user.uid);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("🚨 Cancel error:", error.message);
    const status = error.message.includes("Not authorized") ? 403
      : error.message.includes("not found") ? 404
      : 400;
    res.status(status).json({ error: error.message });
  }
});

// ============================================
// TRANSLATOR / REVIEW ENDPOINTS
// ============================================

// GET /api/certification/queue — review queue
router.get(
  "/queue",
  verifyToken,
  requireRole([ROLES.TRANSLATOR, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { status } = req.query;
      const docs = await certService.getReviewQueue(status || null);
      res.json({ success: true, documents: docs });
    } catch (error) {
      console.error("🚨 Queue error:", error.message);
      res.status(500).json({ error: "Failed to fetch queue" });
    }
  }
);

// GET /api/certification/assigned — translator's assigned documents
router.get(
  "/assigned",
  verifyToken,
  requireRole([ROLES.TRANSLATOR, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const docs = await certService.getAssignedDocuments(req.user.uid);
      res.json({ success: true, documents: docs });
    } catch (error) {
      console.error("🚨 Assigned error:", error.message);
      res.status(500).json({ error: "Failed to fetch assigned documents" });
    }
  }
);

// POST /api/certification/claim/:docId — claim for review
router.post(
  "/claim/:docId",
  verifyToken,
  requireRole([ROLES.TRANSLATOR, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const result = await certService.claimForReview(req.params.docId, req.user.uid);

      // Notify user their doc is being reviewed
      const doc = await certService.getDocument(req.params.docId);
      if (doc) {
        notifications.onDocumentClaimed(doc, req.user.uid).catch((err) => console.error("⚠️ Claim notification failed:", err.message));
      } else {
        console.warn("⚠️ Could not find document for claim notification:", req.params.docId);
      }

      res.json({ success: true, ...result });
    } catch (error) {
      console.error("🚨 Claim error:", error.message);
      const status = error.message.includes("not found") ? 404 : 400;
      res.status(status).json({ error: error.message });
    }
  }
);

// POST /api/certification/release/:docId — release back to queue
router.post(
  "/release/:docId",
  verifyToken,
  requireRole([ROLES.TRANSLATOR, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const result = await certService.releaseDocument(req.params.docId, req.user.uid);
      res.json({ success: true, ...result });
    } catch (error) {
      console.error("🚨 Release error:", error.message);
      const status = error.message.includes("not found") ? 404
        : error.message.includes("Not assigned") ? 403
        : 400;
      res.status(status).json({ error: error.message });
    }
  }
);

// PUT /api/certification/edit/:docId — save translator edits
router.put(
  "/edit/:docId",
  verifyToken,
  requireRole([ROLES.TRANSLATOR, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { editedData } = req.body;
      if (!editedData) {
        return res.status(400).json({ error: "editedData is required" });
      }

      const result = await certService.updateEditedData(
        req.params.docId,
        req.user.uid,
        editedData
      );
      res.json({ success: true, ...result });
    } catch (error) {
      console.error("🚨 Edit error:", error.message);
      const status = error.message.includes("not found") ? 404
        : error.message.includes("Not assigned") ? 403
        : 400;
      res.status(status).json({ error: error.message });
    }
  }
);

// POST /api/certification/certify/:docId — certify document (freeze PDF + hash)
router.post(
  "/certify/:docId",
  verifyToken,
  requireRole([ROLES.TRANSLATOR, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { pdfBase64 } = req.body;
      if (!pdfBase64) {
        return res.status(400).json({ error: "pdfBase64 is required" });
      }

      const pdfBuffer = Buffer.from(pdfBase64, "base64");

      // Upload certified PDF to storage
      const storagePath = `certified/${req.params.docId}/certified.pdf`;
      const storageResult = await uploadBufferToStorage(pdfBuffer, storagePath, {
        contentType: "application/pdf",
        originalName: "certified.pdf",
        userId: req.user.uid,
        formType: "certified",
      });

      // Certify in Firestore
      const result = await certService.certifyDocument(
        req.params.docId,
        req.user.uid,
        pdfBuffer
      );

      // Update with storage URL
      if (storageResult.success) {
        const db = admin.firestore();
        await db.collection("certifiedDocuments").doc(req.params.docId).update({
          "certification.pdfUrl": storageResult.url,
          "certification.pdfStoragePath": storagePath,
        });
        result.pdfUrl = storageResult.url;
      }

      // Notify user of certification
      const doc = await certService.getDocument(req.params.docId);
      if (doc) {
        notifications.onDocumentCertified(doc, result.certificationId).catch((err) => console.error("⚠️ Certification notification failed:", err.message));
      } else {
        console.warn("⚠️ Could not find document for certification notification:", req.params.docId);
      }

      res.json({ success: true, ...result });
    } catch (error) {
      console.error("🚨 Certification error:", error.message);
      const status = error.message.includes("not found") ? 404
        : error.message.includes("Not assigned") ? 403
        : 400;
      res.status(status).json({ error: error.message });
    }
  }
);

// POST /api/certification/reject/:docId — reject document
router.post(
  "/reject/:docId",
  verifyToken,
  requireRole([ROLES.TRANSLATOR, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { reason, rejectionType } = req.body;
      if (!reason) {
        return res.status(400).json({ error: "Rejection reason is required" });
      }

      const result = await certService.rejectDocument(
        req.params.docId,
        req.user.uid,
        reason,
        rejectionType
      );

      // Notify user of rejection
      const doc = await certService.getDocument(req.params.docId);
      if (doc) {
        notifications.onDocumentRejected(doc, reason, rejectionType).catch((err) => console.error("⚠️ Rejection notification failed:", err.message));
      } else {
        console.warn("⚠️ Could not find document for rejection notification:", req.params.docId);
      }

      res.json({ success: true, ...result });
    } catch (error) {
      console.error("🚨 Rejection error:", error.message);
      const status = error.message.includes("not found") ? 404
        : error.message.includes("Not assigned") ? 403
        : 400;
      res.status(status).json({ error: error.message });
    }
  }
);

// ============================================
// PUBLIC VERIFICATION ENDPOINTS
// ============================================

// GET /api/certification/verify/:certificationId — public verification
router.get("/verify/:certificationId", async (req, res) => {
  try {
    const { certificationId } = req.params;

    if (!isValidCertificationId(certificationId)) {
      return res.status(400).json({ error: "Invalid certification ID format" });
    }

    const result = await certService.verifyByCertificationId(certificationId);
    if (!result) {
      return res.status(404).json({ error: "Certificate not found" });
    }

    res.json({ success: true, verified: true, certificate: result });
  } catch (error) {
    console.error("🚨 Verification error:", error.message);
    res.status(500).json({ error: "Verification failed" });
  }
});

// ============================================
// DOWNLOAD ENDPOINT (authenticated)
// ============================================

// GET /api/certification/download/:docId — generate certified PDF on-the-fly (no watermark)
router.get("/download/:docId", verifyToken, async (req, res) => {
  let browser;
  try {
    const doc = await certService.getDocument(req.params.docId);
    if (!doc) return res.status(404).json({ error: "Document not found" });

    if (doc.userId !== req.user.uid) {
      return res.status(403).json({ error: "Not authorized" });
    }

    if (doc.status !== "certified") {
      return res.status(400).json({ error: "Document is not certified" });
    }

    // Use certifiedData (frozen at approval) or fall back to editedData/originalData
    const studentData = doc.certifiedData || doc.editedData || doc.originalData;
    if (!studentData) {
      return res.status(400).json({ error: "No document data available" });
    }

    const formType = doc.formType || studentData.formType || "form6";
    studentData.formType = formType;
    // Use NTC certification ID for QR code verification, fall back to bulletin/doc ID
    studentData.documentId = doc.certification?.certificationId || doc.bulletinId || req.params.docId;
    studentData.firestoreId = doc.bulletinId || req.params.docId;
    studentData.id = doc.bulletinId || req.params.docId;

    const tableSize = studentData.tableSize || "auto";
    const frontendUrl = config.frontend.url;

    // Launch Puppeteer to render the template without watermark
    const puppeteer = require("puppeteer");
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 2 });

    // Navigate to card-only page WITHOUT watermark
    const cardUrl = `${frontendUrl}/card-only?tableSize=${encodeURIComponent(tableSize)}`;
    await page.goto(cardUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Wait for React to mount
    await page.waitForFunction(
      () => {
        const root = document.querySelector("#root");
        return root && root.children.length > 0;
      },
      { timeout: 20000, polling: 500 }
    );

    // Inject certified data
    await page.evaluate((data) => {
      window.studentData = data;
      window.injectedStudentData = data;
      window.dispatchEvent(new CustomEvent("studentDataLoaded", { detail: data }));
      window.dispatchEvent(new Event("resize"));
    }, studentData);

    await new Promise((resolve) => setTimeout(resolve, 4000));

    // Wait for template to render
    await page.waitForSelector("#bulletin-template", { timeout: 15000 });

    // Wait for meaningful content
    await page.waitForFunction(
      () => {
        const template = document.querySelector("#bulletin-template");
        if (!template) return false;
        return template.innerHTML.length > 1000 && template.textContent.trim().length > 100;
      },
      { timeout: 20000 }
    );

    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Wait for images (QR codes etc.)
    await page.waitForFunction(
      () => {
        const images = Array.from(document.querySelectorAll("img"));
        return images.every((img) => img.complete && img.naturalHeight !== 0);
      },
      { timeout: 15000, polling: 1000 }
    ).catch(() => {});

    // Hide everything except the bulletin template
    await page.evaluate(() => {
      const bulletinElement = document.querySelector("#bulletin-template");
      if (bulletinElement) {
        const bulletinContainer = bulletinElement.closest(".bulletin-container") || bulletinElement.parentElement;
        Array.from(document.body.children).forEach((child) => {
          if (!child.contains(bulletinContainer)) child.style.display = "none";
        });
        bulletinContainer.style.display = "block";
        bulletinContainer.style.margin = "0";
        bulletinContainer.style.padding = "0";
        bulletinElement.style.boxShadow = "none";
        bulletinElement.style.border = "none";
      }
    });

    // Generate PDF
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" },
      preferCSSPageSize: true,
    });

    await browser.close();
    browser = null;

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="certified-${doc.certification?.certificationId || req.params.docId}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (error) {
    console.error("🚨 Download/PDF generation error:", error.message);
    if (browser) await browser.close().catch(() => {});
    res.status(500).json({ error: "Failed to generate certified PDF" });
  }
});

// ============================================
// RE-UPLOAD ENDPOINT (rejected documents)
// ============================================

// POST /api/certification/reupload/:docId — re-upload original image for a rejected document
router.post(
  "/reupload/:docId",
  verifyToken,
  upload.single("file"),
  async (req, res) => {
    try {
      const { docId } = req.params;
      const doc = await certService.getDocument(docId);

      if (!doc) return res.status(404).json({ error: "Document not found" });
      if (doc.userId !== req.user.uid) {
        return res.status(403).json({ error: "Not authorized" });
      }
      if (doc.status !== "rejected") {
        return res.status(400).json({ error: "Only rejected documents can be re-uploaded" });
      }
      if (!req.file) {
        return res.status(400).json({ error: "No file provided" });
      }

      // Upload new image to Firebase Storage
      const storagePath = generateStoragePath(
        req.user.uid,
        doc.formType || "reupload",
        req.file.originalname
      );

      const storageResult = await uploadToStorage(req.file.path, storagePath, {
        contentType: req.file.mimetype,
        originalName: req.file.originalname,
        userId: req.user.uid,
        formType: doc.formType,
      });

      // Clean up local file
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

      if (!storageResult.success) {
        return res.status(500).json({ error: "Failed to upload file" });
      }

      // Preserve rejection history before clearing current rejection
      const rejectionEntry = {
        reason: doc.review?.rejectionReason || null,
        rejectionType: doc.review?.rejectionType || null,
        reviewedBy: doc.review?.reviewedBy || null,
        reviewedAt: doc.review?.reviewedAt || null,
      };

      // Update the document: set new image URL, reset to pending_review, clear rejection
      const db = admin.firestore();
      const updateData = {
        status: "pending_review",
        "metadata.reuploadedImageUrl": storageResult.url,
        "metadata.reuploadedImagePath": storagePath,
        "metadata.reuploadedAt": admin.firestore.FieldValue.serverTimestamp(),
        "metadata.originalStorageUrl": doc.metadata?.storageUrl || null,
        "metadata.storageUrl": storageResult.url,
        "metadata.storagePath": storagePath,
        "metadata.fileName": req.file.originalname,
        "metadata.fileSize": req.file.size,
        "review.rejectionReason": null,
        "review.rejectionType": null,
        "review.reviewedBy": null,
        "review.reviewedAt": null,
        "assignment.assignedTo": null,
        "assignment.claimedAt": null,
        resubmissionCount: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      // Only add to rejection history if there was a valid rejection
      if (rejectionEntry.reason) {
        updateData.rejectionHistory = admin.firestore.FieldValue.arrayUnion(rejectionEntry);
      }

      await db.collection("certifiedDocuments").doc(docId).update(updateData);

      // Notify translators about the re-upload and confirm to user
      const updatedDoc = await certService.getDocument(docId);
      if (updatedDoc) {
        notifications.onDocumentSubmitted(updatedDoc).catch((err) => console.error("⚠️ Re-upload translator notification failed:", err.message));
        notifications.onDocumentResubmitted(updatedDoc).catch((err) => console.error("⚠️ Re-upload user notification failed:", err.message));
      } else {
        console.warn("⚠️ Could not find document for re-upload notification:", docId);
      }

      res.json({
        success: true,
        message: "Document re-uploaded successfully. It will be reviewed again.",
        storageUrl: storageResult.url,
      });
    } catch (error) {
      console.error("\ud83d\udea8 Re-upload error:", error.message);
      // Clean up local file on error
      if (req.file) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      }
      res.status(500).json({ error: "Failed to re-upload document" });
    }
  }
);

module.exports = router;

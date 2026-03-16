// PDF Export Route - FIRESTORE-FIRST VERSION
// Uses Puppeteer to generate pixel-perfect PDFs from React components
// NO LONGER USES LOCALSTORAGE - ALL DATA COMES FROM FIRESTORE

const express = require("express");
const puppeteer = require("puppeteer");
const admin = require("firebase-admin");
const QRCode = require("qrcode");
const config = require("../config/env");
const router = express.Router();

// Initialize Firebase Admin if not already initialized
const { initializeFirebaseAdmin } = require("../auth");

// POST /api/export-pdf - Generate PDF from React component with FIRESTORE-ONLY support
router.post("/export-pdf", async (req, res) => {
  let browser;

  try {
    console.log("🔄 Starting FIRESTORE-FIRST PDF generation...");
    console.log("📊 Received request body:", JSON.stringify(req.body, null, 2));

    // Extract data from request body - either firestoreId (bulletins) or certDocId (certifiedDocuments) is required
    const {
      firestoreId, // Firestore bulletin document ID
      certDocId, // Certified document ID (from certifiedDocuments collection)
      frontendUrl = config.frontend.url, // Use Vite default port 5173
      waitSelector = "#bulletin-template",
      waitForImages = false, // NEW: Wait for images including QR codes
      watermark = false, // When true, render "AI DRAFT" watermark on generalDocument pages
      pdfOptions = {},
    } = req.body;

    console.log("🔥 Firestore ID received:", firestoreId, "| Cert Doc ID:", certDocId);

    // Require at least one document identifier
    if (!firestoreId && !certDocId) {
      console.error(
        "❌ No document ID provided - PDF generation requires a Firestore document ID",
      );
      return res.status(400).json({
        error:
          "Missing document ID. Provide either firestoreId or certDocId.",
        debug: {
          requestBody: req.body,
          hasFirestoreId: !!firestoreId,
          hasCertDocId: !!certDocId,
        },
      });
    }

    // Declare variables in outer scope to be accessible throughout the route
    let finalStudentData = null;
    let formType = "form6"; // Default form type
    let tableSize = "auto"; // Default table size
    // documentId used for QR codes — prefer bulletinId for certified docs
    let resolvedDocumentId = firestoreId || certDocId;

    try {
      initializeFirebaseAdmin();
      const db = admin.firestore();
      const { cache, TTL, keys } = require('../services/cache');

      if (certDocId) {
        // ── Certified document path ──
        const cacheKey = keys.certDoc(certDocId);
        const certData = await cache.getOrSet(cacheKey, TTL.DOCUMENT, async () => {
          const certDoc = await db
            .collection("certifiedDocuments")
            .doc(certDocId)
            .get();
          return certDoc.exists ? certDoc.data() : null;
        });

        if (!certData) {
          console.error("❌ Certified document not found:", certDocId);
          return res.status(404).json({
            error: "Certified document not found in Firestore",
            debug: { certDocId, collection: "certifiedDocuments" },
          });
        }
        // Use certifiedData (frozen at approval), then editedData, then originalData
        finalStudentData = certData.certifiedData || certData.editedData || certData.originalData;
        formType = certData.formType || finalStudentData?.formType || "form6";
        tableSize = finalStudentData?.tableSize || "auto";
        resolvedDocumentId = certData.bulletinId || certDocId;

        if (finalStudentData) {
          finalStudentData.formType = formType;
        }

        console.log("✅ Retrieved certified document data from Firestore");
        console.log("📊 Data structure:", {
          hasCertifiedData: !!certData.certifiedData,
          hasEditedData: !!certData.editedData,
          hasOriginalData: !!certData.originalData,
          formType,
          tableSize,
          dataKeys: finalStudentData ? Object.keys(finalStudentData) : [],
        });
      } else {
        // ── Bulletin (draft) path ──
        const cacheKey = keys.bulletin(firestoreId);
        const bulletinData = await cache.getOrSet(cacheKey, TTL.DOCUMENT, async () => {
          const bulletinDoc = await db
            .collection("bulletins")
            .doc(firestoreId)
            .get();
          return bulletinDoc.exists ? bulletinDoc.data() : null;
        });

        if (!bulletinData) {
          console.error("❌ Firestore document not found:", firestoreId);
          return res.status(404).json({
            error: "Bulletin not found in Firestore",
            debug: {
              firestoreId: firestoreId,
              collection: "bulletins",
            },
          });
        }
        // Use editedData if available (latest changes), otherwise fall back to originalData
        finalStudentData = bulletinData.editedData || bulletinData.originalData;
        formType =
          bulletinData.formType || bulletinData.metadata?.formType || "form6";
        tableSize = finalStudentData?.tableSize || "auto";

        if (finalStudentData) {
          finalStudentData.formType = formType;
        }

        console.log(
          "✅ Retrieved latest data from Firestore:",
          JSON.stringify(finalStudentData, null, 2),
        );
        console.log("📊 Data structure:", {
          hasEditedData: !!bulletinData.editedData,
          hasOriginalData: !!bulletinData.originalData,
          usingEditedData: !!bulletinData.editedData,
          studentName: finalStudentData?.studentName,
          formType: formType,
          tableSize: tableSize,
          dataKeys: finalStudentData ? Object.keys(finalStudentData) : [],
        });
      }
    } catch (firestoreError) {
      console.error(
        "❌ Failed to retrieve from Firestore:",
        firestoreError.message,
      );
      return res.status(500).json({
        error: "Failed to retrieve document data from Firestore",
        details: firestoreError.message,
      });
    }

    if (!finalStudentData) {
      console.error("❌ No student data available in Firestore document");
      return res.status(400).json({
        error: "No student data found in Firestore document",
        debug: {
          firestoreId: firestoreId || certDocId,
        },
      });
    }

    // Launch Puppeteer browser
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-zygote",
        "--disable-web-security",
        "--disable-features=VizDisplayCompositor",
      ],
    });

    const page = await browser.newPage();

    // Log browser console and errors for debugging
    page.on('console', msg => console.log('🌐 Browser console:', msg.type(), msg.text()));
    page.on('pageerror', err => console.error('🌐 Browser page error:', err.message));
    page.on('requestfailed', req => console.error('🌐 Request failed:', req.url(), req.failure()?.errorText));

    // Determine if this template needs landscape orientation
    const LANDSCAPE_FORM_TYPES = [
      'stateDiploma',
      'bachelorDiploma',
      'collegeAttestation',
      'highSchoolAttestation',
      'stateExamAttestation',
    ];
    const needsLandscape = LANDSCAPE_FORM_TYPES.includes(formType);

    // Set viewport for consistent rendering (wider for landscape templates)
    await page.setViewport({
      width: needsLandscape ? 1200 : 1200,
      height: needsLandscape ? 850 : 1600,
      deviceScaleFactor: 2,
    });

    // Navigate to the card-only page with table size parameter
    const cardUrl = `${frontendUrl}/card-only?tableSize=${encodeURIComponent(
      tableSize,
    )}${watermark ? '&watermark=1' : ''}`;
    console.log("🌐 Navigating to:", cardUrl);

    await page.goto(cardUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Wait for React to load — Vite dev server uses HMR websocket which
    // keeps connections alive, making networkidle2 unreliable.
    // Poll for React root to have content instead.
    console.log("⏳ Waiting for React app to load...");
    try {
      await page.waitForFunction(
        () => {
          const root = document.querySelector("#root");
          return root && root.children.length > 0;
        },
        { timeout: 20000, polling: 500 },
      );
    } catch {
      // If React didn't mount, try reloading once
      console.log("⚠️ React not mounted, retrying page load...");
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForFunction(
        () => {
          const root = document.querySelector("#root");
          return root && root.children.length > 0;
        },
        { timeout: 20000, polling: 500 },
      );
    }

    // Always inject data for PDF generation to ensure reliability
    console.log(
      "💉 Injecting fresh student data from Firestore for PDF generation",
    );
    console.log(
      "💉 Injecting student data:",
      JSON.stringify(finalStudentData, null, 2),
    );
    console.log(
      `🎯 PDF Generation: Using formType: ${formType} for template selection`,
    );

    // Normalize the student data - handle different structures
    let normalizedData = finalStudentData;

    // If the data has success property (OpenAI response), use the data property
    if (finalStudentData.success && finalStudentData.data) {
      console.log("📊 Using OpenAI response structure (success + data)");
      normalizedData = finalStudentData.data;
    }
    // If the data has a translatedData property, use that
    else if (finalStudentData.translatedData) {
      console.log("📊 Using translatedData structure");
      normalizedData = finalStudentData.translatedData;
    }
    // If the data has extractedData property, use that
    else if (finalStudentData.extractedData) {
      console.log("📊 Using extractedData structure");
      normalizedData = finalStudentData.extractedData;
    }
    // If the data has processing property, use that
    else if (finalStudentData.processing) {
      console.log("📊 Using processing structure");
      normalizedData = finalStudentData.processing;

      // If processing has data property, use that
      if (normalizedData.data) {
        console.log("📊 Using processing.data structure");
        normalizedData = normalizedData.data;
      }
      // If processing has translatedData property, use that
      else if (normalizedData.translatedData) {
        console.log("📊 Using processing.translatedData structure");
        normalizedData = normalizedData.translatedData;
      }
      // If processing has extractedData property, use that
      else if (normalizedData.extractedData) {
        console.log("📊 Using processing.extractedData structure");
        normalizedData = normalizedData.extractedData;
      }
    }
    // If the data has data property (nested structure), use that
    else if (finalStudentData.data) {
      console.log("📊 Using nested data structure");
      normalizedData = finalStudentData.data;
    }

    // Ensure the resolved formType is always on the normalized data
    // (normalization may have replaced finalStudentData with a sub-object that lacks it)
    normalizedData.formType = formType;

    // ADD FIRESTORE DOCUMENT ID FOR QR CODE GENERATION
    normalizedData.documentId = resolvedDocumentId;
    normalizedData.firestoreId = resolvedDocumentId;
    normalizedData.id = resolvedDocumentId;

    // Pre-generate QR code data URL so the frontend doesn't need to fetch from backend
    // (avoids circular HTTP dependency: backend → Puppeteer → frontend → backend)
    try {
      const baseUrl = process.env.FRONTEND_URL || "https://nyotatranslate.com";
      const isCertId = /^NTC-\d{4}-[A-Z2-9]{6}$/.test(resolvedDocumentId);
      const verificationUrl = isCertId
        ? `${baseUrl}/verify?cert=${resolvedDocumentId}`
        : `${baseUrl}/verify?doc=${resolvedDocumentId}`;
      normalizedData.qrDataUrl = await QRCode.toDataURL(verificationUrl, {
        width: 300,
        margin: 1,
        color: { dark: "#000000", light: "#ffffff00" },
        errorCorrectionLevel: "M",
      });
      console.log("✅ Pre-generated QR code data URL for PDF");
    } catch (qrErr) {
      console.warn("⚠️ Failed to pre-generate QR code:", qrErr.message);
    }

    // Normalize table rows in pages — AI may return row objects {"0":"val"} instead of arrays
    if (normalizedData.pages && Array.isArray(normalizedData.pages)) {
      for (const page of normalizedData.pages) {
        if (!page.blocks || !Array.isArray(page.blocks)) continue;
        for (const block of page.blocks) {
          if (block.type === 'table' && Array.isArray(block.rows)) {
            block.rows = block.rows.map(row => {
              if (Array.isArray(row)) return row;
              if (row && typeof row === 'object') {
                return Object.keys(row)
                  .sort((a, b) => Number(a) - Number(b))
                  .map(k => String(row[k] ?? ''));
              }
              return [String(row ?? '')];
            });
          }
        }
      }
      console.log("✅ Normalized table rows in page blocks");
    }

    console.log(
      "📊 Normalized data for injection (with documentId):",
      JSON.stringify(normalizedData, null, 2),
    );

    await page.evaluate((data) => {
      console.log("🔧 Setting window.studentData to:", data);
      console.log("🔧 Data structure check:", {
        hasStudentName: !!data.studentName,
        hasSubjects: !!data.subjects,
        subjectCount: data.subjects?.length || 0,
        hasClass: !!data.class,
        hasSchool: !!data.school,
        dataKeys: Object.keys(data),
        studentNameValue: data.studentName,
        firstSubject: data.subjects?.[0]?.subject,
      });

      window.studentData = data;
      // Also set a backup property
      window.injectedStudentData = data;

      // Dispatch custom event to notify React component
      window.dispatchEvent(
        new CustomEvent("studentDataLoaded", { detail: data }),
      );
      console.log("✅ Fresh Firestore data injected and event dispatched");

      // Force a re-render by touching the DOM
      const event = new Event("resize");
      window.dispatchEvent(event);
    }, normalizedData);

    // Wait longer for React to process the injected data
    console.log("⏳ Waiting for React to process injected fresh data...");
    await new Promise((resolve) => setTimeout(resolve, 4000)); // Increased from 2 to 4 seconds

    // Debug: Check if data was properly injected
    const injectionCheck = await page.evaluate(() => {
      return {
        hasWindowStudentData: !!window.studentData,
        hasWindowInjectedData: !!window.injectedStudentData,
        studentDataKeys: window.studentData
          ? Object.keys(window.studentData)
          : [],
        studentName: window.studentData?.studentName,
        subjectCount: window.studentData?.subjects?.length || 0,
      };
    });
    console.log("🔍 Fresh data injection check:", injectionCheck);

    // Wait for the bulletin template to render with data
    console.log("⏳ Waiting for bulletin template to render...");
    console.log("🔍 Looking for student name:", normalizedData.studentName);

    // Wait for #bulletin-template to exist AND have substantial rendered content
    // (CardOnlyPage always renders #bulletin-template — first as loading spinner, then as actual template)
    try {
      await page.waitForFunction(
        (expectedStudentName) => {
          const template =
            document.querySelector("#bulletin-template") ||
            document.querySelector('[data-testid="bulletin-template"]') ||
            document.querySelector(".bulletin-container");

          if (!template) return false;

          const templateText = template.textContent || "";
          const templateHTML = template.innerHTML || "";

          // Must not be the loading spinner
          if (templateText.includes("Loading bulletin template")) return false;
          if (templateText.includes("No student data available")) return false;

          // Check for substantial content (template has rendered, not just empty shell)
          const hasSubstantialContent = templateHTML.length > 1000;
          const hasAnyMeaningfulContent = templateText.trim().length > 100;

          // Check for student name presence
          const hasStudentName =
            (expectedStudentName && expectedStudentName !== "undefined" && templateText.includes(expectedStudentName)) ||
            templateText.includes("MUKENDI") ||
            templateText.includes("Student Name") ||
            templateText.includes("Test Student");

          // Check for template structure keywords (covers bulletins + DRC templates + general)
          const hasTemplateStructure =
            templateText.includes("Student Information") ||
            templateText.includes("Grade") ||
            templateText.includes("Subject") ||
            templateText.includes("Mathematics") ||
            templateHTML.includes("table") ||
            templateHTML.includes("student-name") ||
            // DRC template keywords
            templateText.includes("DIPLOMA") ||
            templateText.includes("REPUBLIC") ||
            templateText.includes("ATTESTATION") ||
            templateText.includes("TRANSCRIPT") ||
            templateText.includes("UNIVERSITY") ||
            templateText.includes("MINISTRY") ||
            templateText.includes("Certificate") ||
            templateText.includes("Diploma") ||
            // General document keywords
            templateHTML.includes("page-block") ||
            templateHTML.includes("document-page");

          // Pass if we have enough rendered content
          return (
            (hasStudentName && hasSubstantialContent) ||
            (hasTemplateStructure && hasAnyMeaningfulContent) ||
            (hasSubstantialContent && hasAnyMeaningfulContent)
          );
        },
        { timeout: 25000, polling: 1000 },
        normalizedData?.studentName || "MUKENDI",
      );
      console.log("✅ Template rendered with content");
    } catch (waitError) {
      // Even if the content check times out, check if template exists at all
      const debugInfo = await page.evaluate(() => {
        const tmpl = document.querySelector("#bulletin-template");
        const root = document.querySelector("#root");
        return {
          hasTemplate: !!tmpl,
          templateHTML: tmpl ? tmpl.innerHTML.length : 0,
          templateText: tmpl ? (tmpl.textContent || "").substring(0, 300) : "N/A",
          rootHTML: root ? root.innerHTML.substring(0, 500) : "No root",
        };
      });
      console.warn("⚠️ Template content wait timed out. Debug:", debugInfo);
      // If template has some content (>500 chars HTML), proceed anyway
      if (debugInfo.hasTemplate && debugInfo.templateHTML > 500) {
        console.log("⚠️ Proceeding with partially loaded template");
      } else {
        throw new Error("Could not find rendered bulletin template on page");
      }
    }

    // Wait an additional moment for any dynamic content to load
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Wait for images if requested (especially QR codes)
    if (waitForImages) {
      console.log("⏳ Waiting for images (including QR codes) to load...");

      try {
        await page.waitForFunction(
          () => {
            const images = Array.from(document.querySelectorAll("img"));
            if (images.length === 0) return true; // No images to wait for

            // Count loaded vs total
            let loaded = 0;
            let total = images.length;
            for (const img of images) {
              if (img.complete && img.naturalHeight !== 0) {
                loaded++;
              }
            }

            console.log(`Images: ${loaded}/${total} loaded`);
            // Pass if all loaded, or if at least some loaded (QR may fail in Puppeteer context)
            return loaded === total;
          },
          { timeout: 10000, polling: 1000 },
        );
        console.log("✅ All images loaded");
      } catch (imgError) {
        // Non-fatal — proceed with PDF even if some images (like QR codes) didn't load
        const imgDebug = await page.evaluate(() => {
          const imgs = Array.from(document.querySelectorAll("img"));
          return imgs.map((img) => ({
            src: (img.src || "").substring(0, 80),
            complete: img.complete,
            height: img.naturalHeight,
          }));
        });
        console.warn("⚠️ Some images did not load in time, proceeding anyway:", imgDebug);
      }
    }

    // Hide all elements except the bulletin template
    await page.evaluate((selector, isLandscape) => {
      // Hide body's direct children except the bulletin container
      const body = document.body;
      const bulletinElement = document.querySelector(selector);

      if (bulletinElement) {
        // Find the bulletin container (usually the parent of the bulletin template)
        const bulletinContainer =
          bulletinElement.closest(".bulletin-container") ||
          bulletinElement.parentElement;

        // Hide all other elements
        Array.from(body.children).forEach((child) => {
          if (!child.contains(bulletinContainer)) {
            child.style.display = "none";
          }
        });

        // Ensure bulletin is visible and properly positioned
        bulletinContainer.style.display = "block";
        bulletinContainer.style.margin = "0";
        bulletinContainer.style.padding = "0";

        // Remove any shadows or borders that might affect PDF
        bulletinElement.style.boxShadow = "none";
        bulletinElement.style.border = "none";

        // For landscape templates, inject CSS @page rule
        if (isLandscape) {
          document.body.style.width = "297mm";
          document.body.style.height = "210mm";
          document.body.style.margin = "0";

          const style = document.createElement("style");
          style.textContent = `
            @page { size: A4 landscape; margin: 0; }
            @media print { body { margin: 0; } }
          `;
          document.head.appendChild(style);
        }
      }
    }, waitSelector, needsLandscape);

    // Generate PDF
    const defaultPdfOptions = {
      format: "A4",
      printBackground: true,
      landscape: needsLandscape,
      margin: {
        top: needsLandscape ? "5mm" : "10mm",
        bottom: needsLandscape ? "5mm" : "10mm",
        left: needsLandscape ? "5mm" : "10mm",
        right: needsLandscape ? "5mm" : "10mm",
      },
      preferCSSPageSize: true,
    };

    const finalPdfOptions = { ...defaultPdfOptions, ...pdfOptions };
    // Ensure landscape is always set correctly based on formType (override client pdfOptions)
    finalPdfOptions.landscape = needsLandscape;
    console.log("📄 Generating PDF with options:", finalPdfOptions);

    const pdfBuffer = await page.pdf(finalPdfOptions);

    // Set response headers for PDF download
    const studentName = normalizedData.studentName || "Student";
    const filename = `${studentName.replace(/\s+/g, "_")}_Report_Card.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);

    // Send PDF buffer as binary data
    res.end(pdfBuffer, "binary");

    console.log("✅ PDF generated successfully from Firestore data:", filename);
  } catch (error) {
    console.error("❌ PDF generation failed:", error);
    res.status(500).json({
      error: "PDF generation failed",
      details: error.message,
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

module.exports = router;

// PDF Export Route - FIRESTORE-FIRST VERSION
// Uses Puppeteer to generate pixel-perfect PDFs from React components
// NO LONGER USES LOCALSTORAGE - ALL DATA COMES FROM FIRESTORE

const express = require("express");
const puppeteer = require("puppeteer");
const admin = require("firebase-admin");
const router = express.Router();

// Initialize Firebase Admin if not already initialized
const { initializeFirebaseAdmin } = require("../auth");

// POST /api/export-pdf - Generate PDF from React component with FIRESTORE-ONLY support
router.post("/export-pdf", async (req, res) => {
  let browser;

  try {
    console.log("🔄 Starting FIRESTORE-FIRST PDF generation...");
    console.log("📊 Received request body:", JSON.stringify(req.body, null, 2));

    // Extract data from request body - FIRESTORE ID IS REQUIRED
    const {
      firestoreId, // REQUIRED: Firestore document ID - no longer optional
      frontendUrl = "http://localhost:5173",
      waitSelector = "#bulletin-template",
      pdfOptions = {},
    } = req.body;

    console.log("🔥 Firestore ID received:", firestoreId);

    // FIRESTORE-FIRST: Always fetch data from Firestore
    if (!firestoreId) {
      console.error(
        "❌ No Firestore ID provided - PDF generation requires Firestore document ID"
      );
      return res.status(400).json({
        error:
          "Missing Firestore document ID. PDF generation now requires data to be stored in Firestore.",
      });
    }

    let finalStudentData = null;

    try {
      initializeFirebaseAdmin();
      const db = admin.firestore();
      const bulletinDoc = await db
        .collection("bulletins")
        .doc(firestoreId)
        .get();

      if (!bulletinDoc.exists) {
        console.error("❌ Firestore document not found:", firestoreId);
        return res.status(404).json({
          error: "Bulletin not found in Firestore",
        });
      }

      const bulletinData = bulletinDoc.data();
      // Use editedData if available (latest changes), otherwise fall back to originalData
      finalStudentData = bulletinData.editedData || bulletinData.originalData;

      // Extract form type from Firestore metadata (with backward compatibility)
      const formType =
        bulletinData.formType || bulletinData.metadata?.formType || "form6";

      // Include form type in the student data for template selection
      if (finalStudentData) {
        finalStudentData.formType = formType;
      }

      console.log(
        "✅ Retrieved latest data from Firestore:",
        JSON.stringify(finalStudentData, null, 2)
      );
      console.log("📊 Data structure:", {
        hasEditedData: !!bulletinData.editedData,
        hasOriginalData: !!bulletinData.originalData,
        usingEditedData: !!bulletinData.editedData,
        studentName: finalStudentData?.studentName,
        formType: formType,
        dataKeys: finalStudentData ? Object.keys(finalStudentData) : [],
      });
    } catch (firestoreError) {
      console.error(
        "❌ Failed to retrieve from Firestore:",
        firestoreError.message
      );
      return res.status(500).json({
        error: "Failed to retrieve bulletin data from Firestore",
        details: firestoreError.message,
      });
    }

    if (!finalStudentData) {
      console.error("❌ No student data available in Firestore document");
      return res.status(400).json({
        error: "No student data found in Firestore document",
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
        "--single-process",
        "--disable-web-security",
        "--disable-features=VizDisplayCompositor",
      ],
    });

    const page = await browser.newPage();

    // Set viewport for consistent rendering
    await page.setViewport({
      width: 1200,
      height: 1600,
      deviceScaleFactor: 2,
    });

    // Navigate to the card-only page
    const cardUrl = `${frontendUrl}/card-only`;
    console.log("🌐 Navigating to:", cardUrl);

    await page.goto(cardUrl, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Wait for React to load by checking for the root element
    console.log("⏳ Waiting for React app to load...");
    await page.waitForFunction(
      () => {
        const root = document.querySelector("#root");
        return root && root.children.length > 0;
      },
      { timeout: 15000 }
    );

    // Always inject data for PDF generation to ensure reliability
    console.log(
      "💉 Injecting fresh student data from Firestore for PDF generation"
    );
    console.log(
      "💉 Injecting student data:",
      JSON.stringify(finalStudentData, null, 2)
    );
    console.log(
      `🎯 PDF Generation: Using formType: ${
        finalStudentData.formType || "form6"
      } for template selection`
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

    console.log(
      "📊 Normalized data for injection:",
      JSON.stringify(normalizedData, null, 2)
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
        new CustomEvent("studentDataLoaded", { detail: data })
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

    // Wait for the bulletin template to render
    console.log("⏳ Waiting for bulletin template to render...");

    // Try multiple selectors as fallback
    const selectors = [
      waitSelector,
      '[data-testid="bulletin-template"]',
      ".bulletin-container",
    ];
    let templateFound = false;

    for (const selector of selectors) {
      try {
        console.log(`🔍 Trying selector: ${selector}`);
        await page.waitForSelector(selector, { timeout: 5000 });
        console.log(`✅ Found element with selector: ${selector}`);
        templateFound = true;
        break;
      } catch (error) {
        console.log(`❌ Selector ${selector} not found: ${error.message}`);
      }
    }

    if (!templateFound) {
      // Try to see what's actually on the page
      const pageContent = await page.evaluate(() => {
        return {
          title: document.title,
          bodyContent: document.body
            ? document.body.innerHTML.substring(0, 500)
            : "No body",
          rootContent: document.querySelector("#root")
            ? document.querySelector("#root").innerHTML.substring(0, 500)
            : "No root",
        };
      });
      console.log("📄 Page content debug:", pageContent);
      throw new Error("Could not find bulletin template on page");
    }

    // Wait for content to be populated - check if student name is present
    console.log("⏳ Waiting for student data to be populated in template...");
    console.log("🔍 Looking for student name:", normalizedData.studentName);

    // Debug: Check current template state before waiting
    const templateState = await page.evaluate(() => {
      const template = document.querySelector("#bulletin-template");
      if (!template) return { found: false };

      const textContent = template.textContent || "";
      const htmlLength = template.innerHTML.length;

      return {
        found: true,
        textContent: textContent.substring(0, 200), // First 200 chars
        htmlLength: htmlLength,
        hasStudentName:
          textContent.includes("Student") || textContent.includes("MUKENDI"),
        containsText: textContent.trim().length > 0,
      };
    });

    console.log("📊 Template state before waiting:", templateState);

    await page.waitForFunction(
      (expectedStudentName) => {
        const template =
          document.querySelector("#bulletin-template") ||
          document.querySelector('[data-testid="bulletin-template"]') ||
          document.querySelector(".bulletin-container");

        if (!template) {
          console.log("No template found");
          return false;
        }

        // Check if template has the specific student name from our data
        const templateText = template.textContent || "";
        const templateHTML = template.innerHTML || "";

        // More flexible checks
        const hasStudentName =
          templateText.includes(expectedStudentName) ||
          templateHTML.includes(expectedStudentName) ||
          templateText.includes("MUKENDI") || // Fallback to sample data name
          templateText.includes("Student Name") ||
          templateText.includes("Test Student"); // For test data

        // Check if template has substantial content (not just empty template)
        const hasSubstantialContent = templateHTML.length > 1000; // Reduced threshold

        // Check if template has student information structure
        const hasStudentInfo =
          templateText.includes("Student Information") ||
          templateText.includes("Grade") ||
          templateText.includes("Subject") ||
          templateText.includes("Mathematics") ||
          templateText.includes("English") ||
          templateText.includes("French") ||
          templateHTML.includes("table") ||
          templateHTML.includes("student-name") ||
          templateHTML.includes("subject-grade");

        // Check if we have any data in the template at all
        const hasAnyMeaningfulContent =
          templateText.trim().length > 100 &&
          !templateText.includes("Loading") &&
          !templateText.includes("No data");

        console.log("=== Template Check Results ===");
        console.log("Template found:", !!template);
        console.log("Template text length:", templateText.length);
        console.log("Template HTML length:", templateHTML.length);
        console.log("Expected student name:", expectedStudentName);
        console.log("Has student name:", hasStudentName);
        console.log("Has substantial content:", hasSubstantialContent);
        console.log("Has student info structure:", hasStudentInfo);
        console.log("Has any meaningful content:", hasAnyMeaningfulContent);
        console.log("Template text preview:", templateText.substring(0, 200));
        console.log("==============================");

        // Return true if we have meaningful content OR proper structure
        return (
          (hasStudentName && hasSubstantialContent) ||
          (hasStudentInfo && hasAnyMeaningfulContent) ||
          (hasSubstantialContent && hasAnyMeaningfulContent)
        );
      },
      { timeout: 20000 }, // Increased timeout to 20 seconds
      normalizedData?.studentName || "MUKENDI"
    );

    // Wait an additional moment for any dynamic content to load
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Hide all elements except the bulletin template
    await page.evaluate((selector) => {
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
      }
    }, waitSelector);

    // Generate PDF
    const defaultPdfOptions = {
      format: "A4",
      printBackground: true,
      margin: {
        top: "10mm",
        bottom: "10mm",
        left: "10mm",
        right: "10mm",
      },
      preferCSSPageSize: true,
    };

    const finalPdfOptions = { ...defaultPdfOptions, ...pdfOptions };
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

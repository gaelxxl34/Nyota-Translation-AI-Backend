// Backend route for generating State Exam Attestation PDF
const express = require("express");
const router = express.Router();
const puppeteer = require("puppeteer");
const config = require("../config/env");

/**
 * POST /api/state-exam-attestation-pdf
 * Generates a PDF for the State Exam Attestation document
 */
router.post("/state-exam-attestation-pdf", async (req, res) => {
  let browser;
  let page;

  try {
    console.log("� Starting State Exam Attestation PDF generation...");
    console.log(
      "📊 Received attestation data:",
      JSON.stringify(req.body, null, 2)
    );

    const {
      data: attestationData,
      documentId,
      frontendUrl = config.frontend?.url || "http://localhost:5173",
    } = req.body;

    if (!attestationData) {
      console.error("❌ No attestation data provided");
      return res.status(400).json({
        error: "Missing attestation data",
      });
    }

    console.log("🔍 Generating PDF for attestation:", documentId);

    // Launch Puppeteer with optimized settings
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

    page = await browser.newPage();
    console.log("🌐 Browser and page created successfully");

    // Set viewport for landscape orientation rendering
    await page.setViewport({
      width: 1200,
      height: 850,
      deviceScaleFactor: 2,
      isLandscape: true,
    });

    // Navigate to the card-only page (same as other PDF routes)
    const targetUrl = `${frontendUrl}/card-only`;
    console.log("🌐 Navigating to:", targetUrl);

    await page.goto(targetUrl, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Wait for React to load
    console.log("⏳ Waiting for React app to load...");
    await page.waitForFunction(
      () => {
        const root = document.querySelector("#root");
        return root && root.children.length > 0;
      },
      { timeout: 30000 }
    );

    // Wait additional time for React to fully initialize
    console.log("⏳ Giving React additional time to initialize...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Inject the attestation data
    console.log("💉 Injecting attestation data for PDF generation");
    await page.evaluate(
      (data, docId) => {
        window.isPdfGenerationMode = true;
        // Add formType to ensure CardOnlyPage renders the correct template
        window.pdfAttestationData = {
          ...data,
          formType: "stateExamAttestation",
        };
        window.documentId = docId;

        // Dispatch custom event to notify template
        window.dispatchEvent(
          new CustomEvent("pdf-attestation-data-ready", {
            detail: {
              ...data,
              formType: "stateExamAttestation",
            },
          })
        );
        console.log("✅ Attestation data injected and event dispatched");
      },
      attestationData,
      documentId
    );

    // Wait for the template to render
    console.log("⏳ Waiting for attestation template to be ready...");
    await page.waitForSelector("#state-exam-attestation-template", {
      timeout: 10000,
    });

    // Wait for content to load
    await page.waitForFunction(
      () => {
        const template = document.querySelector(
          "#state-exam-attestation-template"
        );
        if (!template) return false;
        const text = template.textContent || "";
        return text.length > 100;
      },
      { timeout: 10000, polling: 1000 }
    );

    console.log("✅ Template content has loaded successfully");

    // Wait for fonts and images
    await page.evaluate(() => document.fonts.ready);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Isolate and optimize the attestation template for PDF
    await page.evaluate(() => {
      // Hide everything first
      document.querySelectorAll("body > *").forEach((el) => {
        el.style.display = "none";
      });

      const attestationElement = document.querySelector(
        "#state-exam-attestation-template"
      );

      if (attestationElement) {
        const container = document.createElement("div");
        container.id = "pdf-attestation-container";
        container.style.position = "absolute";
        container.style.top = "0";
        container.style.left = "0";
        container.style.width = "100%";
        container.style.height = "100%";
        container.style.backgroundColor = "#f8f5e3";
        container.style.overflow = "hidden";
        container.style.display = "flex";
        container.style.justifyContent = "center";
        container.style.alignItems = "center";

        // Set explicit landscape orientation with CSS
        document.body.style.width = "297mm";
        document.body.style.height = "210mm";
        document.body.style.margin = "0";
        document.body.style.padding = "0";
        document.body.style.overflow = "hidden";
        document.body.style.backgroundColor = "#f8f5e3";

        // Add @page rule for landscape
        const style = document.createElement("style");
        style.textContent = `
          @page {
            size: A4 landscape;
            margin: 0;
            background-color: #f8f5e3;
          }
          body {
            width: 297mm;
            height: 210mm;
            margin: 0;
            padding: 0;
            background-color: #f8f5e3;
          }
          html {
            background-color: #f8f5e3;
          }
        `;
        document.head.appendChild(style);

        // Clone the attestation
        const attestationClone = attestationElement.cloneNode(true);
        attestationClone.style.margin = "0";
        attestationClone.style.padding = "0";
        attestationClone.style.boxShadow = "none";
        attestationClone.style.transform = "none";
        attestationClone.style.transformOrigin = "center";
        attestationClone.style.maxWidth = "100%";
        attestationClone.style.maxHeight = "100%";
        attestationClone.style.backgroundColor = "#f8f5e3";

        container.appendChild(attestationClone);
        document.body.appendChild(container);

        console.log("Attestation isolated and optimized for PDF rendering");
        window.scrollTo(0, 0);
      }
    });

    // Wait for DOM changes
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Set page media type
    await page.emulateMediaType("screen");

    // Force landscape orientation
    await page.evaluate(() => {
      document.body.style.backgroundColor = "#f8f5e3";
      document.documentElement.style.backgroundColor = "#f8f5e3";
    });

    // Generate PDF with landscape orientation
    console.log("📄 Generating PDF with landscape orientation...");
    const pdfBuffer = await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
      margin: {
        top: "5mm",
        bottom: "5mm",
        left: "5mm",
        right: "5mm",
      },
      preferCSSPageSize: false,
      scale: 0.9,
      omitBackground: false,
    });

    console.log(
      "✅ PDF generated successfully, size:",
      pdfBuffer.length,
      "bytes"
    );

    // Set response headers
    const studentName = attestationData.studentName || "attestation";
    const cleanName = studentName.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="STATE_EXAM_ATTESTATION_${cleanName}.pdf"`
    );
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdfBuffer.length);

    console.log("✅ PDF generation successful, sending response");
    return res.end(pdfBuffer, "binary");
  } catch (error) {
    console.error("❌ Error generating State Exam Attestation PDF:", error);
    console.error("❌ Error stack:", error.stack);

    return res.status(500).json({
      error: "Failed to generate PDF",
      details: error.message,
      stack: error.stack,
    });
  } finally {
    if (browser) {
      try {
        console.log("🧹 Cleaning up browser resources...");
        if (page) {
          await page.close();
          console.log("✅ Page closed successfully");
        }
        await browser.close();
        console.log("✅ Browser closed successfully");
      } catch (closeError) {
        console.error("⚠️ Error closing browser:", closeError);
      }
    }
  }
});

module.exports = router;

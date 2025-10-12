// College Attestation PDF Generation Route
// This route generates a PDF from college attestation certificate data

const express = require("express");
const puppeteer = require("puppeteer");
const config = require("../config/env");
const router = express.Router();

// POST /api/college-attestation-pdf - Generate college attestation PDF
router.post("/college-attestation-pdf", async (req, res) => {
  let browser;
  let page;

  try {
    console.log("🔄 Starting College Attestation PDF generation...");
    console.log(
      "📊 Received attestation data:",
      JSON.stringify(req.body, null, 2)
    );

    // Extract data from request body
    const {
      attestationData,
      frontendUrl = config.frontend?.url || "http://localhost:5173",
      waitForImages = false,
      pdfOptions = {
        format: "A4",
        landscape: true, // Landscape orientation for attestation certificate
        printBackground: true,
        margin: { top: "8mm", right: "8mm", bottom: "8mm", left: "8mm" }, // Increased margins for border visibility
        preferCSSPageSize: true,
      },
    } = req.body;

    if (!attestationData) {
      console.error("❌ No attestation data provided");
      return res.status(400).json({
        error:
          "Missing attestation data. Please provide valid college attestation data.",
      });
    }

    // Ensure the attestation data has the correct formType
    if (!attestationData.formType) {
      attestationData.formType = "collegeAttestation";
      console.log("🔧 Added formType 'collegeAttestation' to attestation data");
    }

    console.log("🎯 College Attestation Data:", {
      hasStudentName: !!attestationData.studentName,
      formType: attestationData.formType,
      dataKeys: Object.keys(attestationData),
    });

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

    page = await browser.newPage();
    console.log("🌐 Browser and page created successfully");

    // Set viewport for landscape orientation rendering (A4 landscape dimensions)
    await page.setViewport({
      width: 1200,
      height: 850,
      deviceScaleFactor: 2,
      isLandscape: true,
    });

    // Navigate to the card-only page
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
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Inject the attestation data into the page
    console.log("💉 Injecting college attestation data for PDF generation");
    await page.evaluate((data) => {
      console.log("🔧 Setting window.studentData to:", data);
      console.log("🔧 Data structure check:", {
        hasStudentName: !!data.studentName,
        hasFormType: !!data.formType,
        formType: data.formType,
        dataKeys: Object.keys(data),
        studentNameValue: data.studentName,
      });

      window.studentData = data;
      window.injectedStudentData = data;
      window.pdfAttestationData = data; // Keep for backwards compatibility

      // Dispatch custom event to notify React component
      window.dispatchEvent(
        new CustomEvent("studentDataLoaded", { detail: data })
      );
      console.log("✅ College attestation data injected and event dispatched");

      // Force a re-render
      const event = new Event("resize");
      window.dispatchEvent(event);
    }, attestationData);

    // Wait for the college attestation template to be rendered
    console.log("⏳ Waiting for college attestation template to be ready...");

    const selectors = [
      "#college-attestation-template",
      '[data-testid="college-attestation-template"]',
      "#bulletin-template",
    ];
    let templateFound = false;

    for (const selector of selectors) {
      try {
        console.log(`🔍 Trying selector: ${selector}`);
        await page.waitForSelector(selector, { timeout: 10000 });
        console.log(`✅ Found element with selector: ${selector}`);
        templateFound = true;
        break;
      } catch (error) {
        console.log(`❌ Selector ${selector} not found: ${error.message}`);
      }
    }

    if (!templateFound) {
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
      throw new Error("Could not find college attestation template on page");
    }

    // Verify template content has loaded
    console.log("⏳ Verifying college attestation content has loaded...");

    const templateState = await page.evaluate(() => {
      const collegeAttestationTemplate = document.querySelector(
        "#college-attestation-template"
      );
      const bulletinTemplate = document.querySelector("#bulletin-template");
      const template = collegeAttestationTemplate || bulletinTemplate;

      if (!template) return { found: false };

      const textContent = template.textContent || "";
      const htmlLength = template.innerHTML.length;

      return {
        found: true,
        templateType: collegeAttestationTemplate
          ? "college-attestation"
          : "bulletin",
        textContent: textContent.substring(0, 200),
        htmlLength: htmlLength,
        hasCollegeAttestation:
          textContent.includes("ATTESTATION") ||
          textContent.includes("FREQUENTATION") ||
          textContent.includes("inscrit"),
        containsText: textContent.trim().length > 0,
      };
    });

    console.log("📊 Template state before waiting:", templateState);

    await page.waitForFunction(
      () => {
        const collegeAttestationTemplate = document.querySelector(
          "#college-attestation-template"
        );
        const bulletinTemplate = document.querySelector("#bulletin-template");
        const template = collegeAttestationTemplate || bulletinTemplate;

        if (!template) {
          console.log("❌ Template element not found");
          return false;
        }

        const textContent = template.textContent || "";
        const hasContent = textContent.trim().length > 100;

        console.log("🔍 Checking template content:", {
          hasElement: !!template,
          textLength: textContent.length,
          hasContent: hasContent,
          preview: textContent.substring(0, 100),
        });

        return hasContent;
      },
      { timeout: 30000, polling: 500 }
    );

    console.log("✅ Template content has loaded successfully");

    // Wait for images if requested
    if (waitForImages) {
      console.log("⏳ Waiting for all images (including QR codes) to load...");

      await page.waitForFunction(
        () => {
          const images = Array.from(document.querySelectorAll("img"));
          const qrImages = Array.from(
            document.querySelectorAll(
              '.qr-container img, [data-print-element="qr-image"]'
            )
          );

          console.log(
            `Found ${images.length} total images, ${qrImages.length} QR images`
          );

          const allImagesLoaded = images.every((img) => {
            if (img.complete && img.naturalHeight !== 0) {
              return true;
            }
            console.log("Waiting for image:", img.src || img.alt || "unknown");
            return false;
          });

          const qrCodesLoaded =
            qrImages.length === 0 ||
            qrImages.every((img) => {
              const loaded = img.complete && img.naturalHeight !== 0;
              if (!loaded) {
                console.log(
                  "Waiting for QR code:",
                  img.src ? img.src.substring(0, 50) : "unknown"
                );
              }
              return loaded;
            });

          console.log(
            `Images loaded: ${allImagesLoaded}, QR codes loaded: ${qrCodesLoaded}`
          );
          return allImagesLoaded && qrCodesLoaded;
        },
        { timeout: 15000, polling: 1000 }
      );

      console.log("✅ All images (including QR codes) have loaded");
    }

    // Additional wait for QR code to fully render
    console.log("⏳ Waiting for QR code to be fully rendered...");
    await page.waitForFunction(
      () => {
        const qrImages = document.querySelectorAll(
          '[data-print-element="qr-image"]'
        );
        if (qrImages.length === 0) {
          console.log("No QR code found on page");
          return true; // Continue even if no QR code
        }
        const allQRsReady = Array.from(qrImages).every((img) => {
          const isComplete =
            img.complete && img.naturalHeight > 0 && img.naturalWidth > 0;
          if (!isComplete) {
            console.log(
              "QR code not ready yet:",
              img.src ? img.src.substring(0, 50) : "unknown"
            );
          }
          return isComplete;
        });
        console.log(`QR codes ready: ${allQRsReady}`);
        return allQRsReady;
      },
      { timeout: 10000, polling: 500 }
    );
    console.log("✅ QR code fully rendered");

    // Extra wait to ensure QR code is stable
    await new Promise((resolve) => setTimeout(resolve, 2000));
    console.log("✅ Additional stabilization wait complete");

    // Additional wait for rendering
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Take a debug screenshot before PDF generation
    try {
      await page.screenshot({
        path: "/tmp/college-attestation-before-pdf.png",
        fullPage: true,
      });
      console.log(
        "📸 Pre-PDF screenshot saved to /tmp/college-attestation-before-pdf.png"
      );
    } catch (screenshotError) {
      console.warn(
        "⚠️ Could not save debug screenshot:",
        screenshotError.message
      );
    }

    // Generate PDF
    const defaultPdfOptions = {
      format: "A4",
      landscape: true, // Landscape mode for attestation certificate
      printBackground: true,
      margin: { top: "8mm", right: "8mm", bottom: "8mm", left: "8mm" },
      preferCSSPageSize: true,
    };

    const finalPdfOptions = {
      ...defaultPdfOptions,
      ...pdfOptions,
      margin: {
        ...defaultPdfOptions.margin,
        ...(pdfOptions?.margin || {}),
      },
    };

    console.log("📄 Generating PDF with options:", finalPdfOptions);
    const pdfOutput = await page.pdf(finalPdfOptions);
    const pdfBuffer = Buffer.isBuffer(pdfOutput)
      ? pdfOutput
      : Buffer.from(pdfOutput);

    console.log("🔍 PDF buffer diagnostics:", {
      isBuffer: Buffer.isBuffer(pdfBuffer),
      byteLength: pdfBuffer.byteLength,
      type: pdfBuffer.constructor?.name,
    });

    console.log("✅ PDF generated successfully");
    console.log("📦 PDF size:", pdfBuffer.length, "bytes");

    // Validate PDF buffer
    if (!pdfBuffer || pdfBuffer.length === 0) {
      throw new Error("Generated PDF buffer is empty");
    }

    // Check for PDF magic bytes (%PDF-)
    const pdfHeaderBytes = pdfBuffer.subarray(0, 5);
    const pdfHeader = pdfHeaderBytes.toString("ascii");
    console.log("🔍 PDF header check:", {
      bytes: Array.from(pdfHeaderBytes),
      ascii: pdfHeader,
      startsWithPDF: pdfHeader.startsWith("%PDF-"),
    });

    if (!pdfHeader.startsWith("%PDF-")) {
      console.error("❌ Invalid PDF header:", {
        expected: "%PDF-",
        actual: pdfHeader,
        bytes: Array.from(pdfBuffer.slice(0, 5)),
      });
      throw new Error("Generated file is not a valid PDF");
    }

    console.log("✅ PDF validation passed - valid PDF format");

    // Set response headers
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=college-attestation-${
        attestationData.studentName?.replace(/\s+/g, "_") || "document"
      }.pdf`
    );
    res.setHeader("Content-Length", pdfBuffer.length);

    // Send PDF
    res.end(pdfBuffer, "binary");
    console.log("✅ PDF sent to client successfully");
  } catch (error) {
    console.error("❌ Error generating college attestation PDF:", error);

    if (!res.headersSent) {
      res.status(500).json({
        error: "Failed to generate college attestation PDF",
        message: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  } finally {
    // Cleanup
    try {
      if (page) {
        await page.close();
        console.log("🧹 Page closed");
      }
      if (browser) {
        await browser.close();
        console.log("🧹 Browser closed");
      }
    } catch (cleanupError) {
      console.error("⚠️ Error during cleanup:", cleanupError);
    }
  }
});

module.exports = router;

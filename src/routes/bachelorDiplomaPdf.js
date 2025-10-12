// Bachelor Diploma PDF Generation Route
// This route generates a PDF from bachelor diploma data for university degrees

const express = require("express");
const puppeteer = require("puppeteer");
const config = require("../config/env");
const router = express.Router();

// POST /api/bachelor-diploma-pdf - Generate bachelor diploma PDF
router.post("/bachelor-diploma-pdf", async (req, res) => {
  let browser;
  let page;

  try {
    console.log("🔄 Starting Bachelor Diploma PDF generation...");
    console.log("📊 Received diploma data:", JSON.stringify(req.body, null, 2));

    // Extract data from request body
    const {
      diplomaData,
      frontendUrl = config.frontend?.url || "http://localhost:5173",
      waitForImages = false,
      pdfOptions = {
        format: "A4",
        landscape: true, // Landscape orientation for bachelor diploma
        printBackground: true,
        margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
      },
    } = req.body;

    if (!diplomaData) {
      console.error("❌ No diploma data provided");
      return res.status(400).json({
        error:
          "Missing diploma data. Please provide valid bachelor diploma data.",
      });
    }

    // Ensure the diploma data has the correct formType
    if (!diplomaData.formType) {
      diplomaData.formType = "bachelorDiploma";
      console.log("🔧 Added formType 'bachelorDiploma' to diploma data");
    }

    console.log("🎯 Bachelor Diploma Data:", {
      hasStudentName: !!diplomaData.studentName,
      formType: diplomaData.formType,
      dataKeys: Object.keys(diplomaData),
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
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Inject the diploma data into the page
    console.log("💉 Injecting bachelor diploma data for PDF generation");
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

      // Dispatch custom event to notify React component
      window.dispatchEvent(
        new CustomEvent("studentDataLoaded", { detail: data })
      );
      console.log("✅ Bachelor diploma data injected and event dispatched");

      // Force a re-render
      const event = new Event("resize");
      window.dispatchEvent(event);
    }, diplomaData);

    // Wait for the bachelor diploma template to be rendered
    console.log("⏳ Waiting for bachelor diploma template to be ready...");

    const selectors = [
      "#bachelor-diploma-template",
      '[data-testid="bachelor-diploma-template"]',
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
      throw new Error("Could not find bachelor diploma template on page");
    }

    // Verify template content has loaded
    console.log("⏳ Verifying bachelor diploma content has loaded...");

    const templateState = await page.evaluate(() => {
      const bachelorDiplomaTemplate = document.querySelector(
        "#bachelor-diploma-template"
      );
      const bulletinTemplate = document.querySelector("#bulletin-template");
      const template = bachelorDiplomaTemplate || bulletinTemplate;

      if (!template) return { found: false };

      const textContent = template.textContent || "";
      const htmlLength = template.innerHTML.length;

      return {
        found: true,
        templateType: bachelorDiplomaTemplate ? "bachelor-diploma" : "bulletin",
        textContent: textContent.substring(0, 200),
        htmlLength: htmlLength,
        hasBachelorDiploma:
          textContent.includes("DIPLOME") || textContent.includes("BACHELOR"),
        containsText: textContent.trim().length > 0,
      };
    });

    console.log("📊 Template state before waiting:", templateState);

    await page.waitForFunction(
      () => {
        const bachelorDiplomaTemplate = document.querySelector(
          "#bachelor-diploma-template"
        );
        const bulletinTemplate = document.querySelector("#bulletin-template");
        const template = bachelorDiplomaTemplate || bulletinTemplate;

        if (!template) {
          console.log("No template found");
          return false;
        }

        const templateText = template.textContent || "";
        const templateHTML = template.innerHTML || "";

        if (bachelorDiplomaTemplate) {
          return templateText.length > 50 && templateHTML.length > 100;
        }

        if (bulletinTemplate) {
          return templateText.length > 100 && templateHTML.length > 1000;
        }

        return false;
      },
      { timeout: 10000, polling: 1000 }
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

    // Isolate and optimize the diploma template for PDF rendering (landscape)
    await page.evaluate(() => {
      // Hide everything first
      document.querySelectorAll("body > *").forEach((el) => {
        el.style.display = "none";
      });

      // Find the bachelor diploma template
      const diplomaElement = document.querySelector(
        "#bachelor-diploma-template"
      );

      if (diplomaElement) {
        // Create a new container for the isolated diploma (landscape orientation)
        const container = document.createElement("div");
        container.id = "pdf-diploma-container";
        container.style.position = "absolute";
        container.style.top = "0";
        container.style.left = "0";
        container.style.width = "100%";
        container.style.height = "100%";
        container.style.backgroundColor = "#ffffff";
        container.style.overflow = "hidden";
        container.style.display = "flex";
        container.style.justifyContent = "center";
        container.style.alignItems = "center";

        // Set explicit landscape orientation
        document.body.style.width = "297mm"; // A4 width in landscape
        document.body.style.height = "210mm"; // A4 height in landscape
        document.body.style.margin = "0";
        document.body.style.padding = "0";
        document.body.style.overflow = "hidden";
        document.body.style.backgroundColor = "#ffffff";

        // Add @page rule for landscape orientation
        const style = document.createElement("style");
        style.textContent = `
          @page {
            size: A4 landscape;
            margin: 0;
            background-color: #ffffff;
          }
          body {
            width: 297mm;
            height: 210mm;
            margin: 0;
            padding: 0;
            background-color: #ffffff;
          }
          html {
            background-color: #ffffff;
          }
          /* Force QR code visibility */
          .qr-container,
          [data-print-element="qr-container"],
          [data-print-element="qr-image"],
          .print-qr-force-visible {
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
            print-color-adjust: exact !important;
            -webkit-print-color-adjust: exact !important;
          }
        `;
        document.head.appendChild(style);

        // Clone the diploma
        const diplomaClone = diplomaElement.cloneNode(true);
        diplomaClone.style.margin = "0";
        diplomaClone.style.padding = "0";
        diplomaClone.style.boxShadow = "none";
        diplomaClone.style.transform = "none";
        diplomaClone.style.transformOrigin = "center";
        diplomaClone.style.maxWidth = "100%";
        diplomaClone.style.maxHeight = "100%";
        diplomaClone.style.backgroundColor = "#ffffff";

        // Add to container
        container.appendChild(diplomaClone);
        document.body.appendChild(container);

        console.log(
          "Bachelor diploma isolated and optimized for landscape PDF rendering"
        );

        // Reset scroll position
        window.scrollTo(0, 0);
      }
    });

    // Wait for DOM changes to take effect
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify QR code is present before PDF generation
    const qrStatus = await page.evaluate(() => {
      const qrImages = document.querySelectorAll(
        '[data-print-element="qr-image"]'
      );
      const qrContainers = document.querySelectorAll(".qr-container");
      return {
        qrImagesCount: qrImages.length,
        qrContainersCount: qrContainers.length,
        firstQrImageSrc: qrImages[0]?.src
          ? qrImages[0].src.substring(0, 100)
          : "none",
        firstQrImageComplete: qrImages[0]?.complete || false,
        firstQrImageDimensions: qrImages[0]
          ? {
              width: qrImages[0].width,
              height: qrImages[0].height,
              naturalWidth: qrImages[0].naturalWidth,
              naturalHeight: qrImages[0].naturalHeight,
            }
          : null,
      };
    });
    console.log("📊 QR Code Status before PDF:", qrStatus);

    // Set page media type for PDF generation
    await page.emulateMediaType("screen");

    // Force landscape orientation
    await page.evaluate(() => {
      window.matchMedia = (query) => {
        return {
          matches: query.includes("orientation: landscape"),
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        };
      };

      document.body.style.backgroundColor = "#ffffff";
      document.documentElement.style.backgroundColor = "#ffffff";

      let metaOrientation = document.querySelector('meta[name="viewport"]');
      if (!metaOrientation) {
        metaOrientation = document.createElement("meta");
        metaOrientation.setAttribute("name", "viewport");
        document.head.appendChild(metaOrientation);
      }
      metaOrientation.setAttribute(
        "content",
        "width=device-width, initial-scale=1.0, viewport-fit=cover, orientation=landscape"
      );
    });

    // Take a screenshot for debugging
    await page.screenshot({
      path: "/tmp/bachelor-diploma-before-pdf.png",
      fullPage: true,
    });
    console.log(
      "📸 Pre-PDF screenshot saved to /tmp/bachelor-diploma-before-pdf.png"
    );

    // Generate PDF with landscape orientation
    console.log("📄 Generating PDF with landscape orientation...");
    const landscapePdfOptions = {
      format: "A4",
      landscape: true, // Landscape orientation
      printBackground: true,
      margin: {
        top: "10mm",
        bottom: "10mm",
        left: "10mm",
        right: "10mm",
      },
      preferCSSPageSize: false,
      scale: 0.95,
      omitBackground: false,
    };

    console.log("📄 Final PDF options:", landscapePdfOptions);

    const pdfBuffer = await page.pdf(landscapePdfOptions);

    // Set content disposition header for download
    const studentName = diplomaData.studentName || "bachelor_diploma";
    const cleanStudentName = studentName
      .replace(/[^a-zA-Z0-9]/g, "_")
      .toUpperCase();

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="BACHELOR_DIPLOMA_${cleanStudentName}.pdf"`
    );
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdfBuffer.length);

    // Send the PDF
    console.log(
      "✅ Bachelor diploma PDF generation successful, sending response"
    );
    return res.end(pdfBuffer, "binary");
  } catch (error) {
    console.error("❌ Error generating bachelor diploma PDF:", error);
    console.error("❌ Error stack:", error.stack);

    try {
      if (browser && page) {
        await page.screenshot({
          path: "/tmp/bachelor-diploma-error.png",
          fullPage: true,
        });
        console.error(
          "📸 Error state screenshot saved to /tmp/bachelor-diploma-error.png"
        );
      }
    } catch (screenshotError) {
      console.error("❌ Failed to take error screenshot:", screenshotError);
    }

    return res.status(500).json({
      error: "Failed to generate bachelor diploma PDF",
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

// Direct State Diploma PDF Generation Route
// This route directly generates a PDF from the state diploma data without storing in Firestore
// Implementation based on successful pdf.js approach

const express = require("express");
const puppeteer = require("puppeteer");
const config = require("../config/env");
const router = express.Router();

// POST /api/state-diploma-pdf - Generate state diploma PDF directly
router.post("/state-diploma-pdf", async (req, res) => {
  let browser;
  let page;

  try {
    console.log("🔄 Starting direct State Diploma PDF generation...");
    console.log("📊 Received diploma data:", JSON.stringify(req.body, null, 2));

    // Extract data from request body
    const {
      diplomaData,
      frontendUrl = config.frontend?.url || "http://localhost:5173", // Use port 5173 as default
      pdfOptions = {
        format: "A4",
        landscape: true,
        printBackground: true,
        margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
      },
    } = req.body;

    if (!diplomaData) {
      console.error("❌ No diploma data provided");
      return res.status(400).json({
        error: "Missing diploma data. Please provide valid state diploma data.",
      });
    }

    // Ensure the diploma data has the correct formType
    if (!diplomaData.formType) {
      diplomaData.formType = "stateDiploma";
      console.log("🔧 Added formType 'stateDiploma' to diploma data");
    }

    console.log("🎯 State Diploma Data:", {
      hasStudentName: !!diplomaData.studentName,
      formType: diplomaData.formType,
      dataKeys: Object.keys(diplomaData),
    });

    // Launch Puppeteer browser with options from successful pdf.js implementation
    browser = await puppeteer.launch({
      headless: true, // Use the stable headless mode
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
      width: 1200, // Wider width for landscape
      height: 850, // Shorter height for landscape
      deviceScaleFactor: 2,
      isLandscape: true,
    });

    // Navigate to the card-only page for consistent PDF generation
    const targetUrl = `${frontendUrl}/card-only`;
    console.log("🌐 Navigating to:", targetUrl);

    await page.goto(targetUrl, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Wait for React to load by checking for the root element with more patience
    console.log("⏳ Waiting for React app to load...");
    await page.waitForFunction(
      () => {
        const root = document.querySelector("#root");
        return root && root.children.length > 0;
      },
      { timeout: 30000 } // Increased timeout to 30 seconds
    );

    // Wait additional time for React to fully initialize
    console.log("⏳ Giving React additional time to initialize...");
    await new Promise((resolve) => setTimeout(resolve, 3000)); // Wait 3 more seconds

    // Inject the diploma data into the page for rendering (using same pattern as regular PDF generation)
    console.log("💉 Injecting diploma data for PDF generation");
    await page.evaluate((data) => {
      console.log("🔧 Setting window.studentData to:", data);
      console.log("🔧 Data structure check:", {
        hasStudentName: !!data.studentName,
        hasFormType: !!data.formType,
        formType: data.formType,
        dataKeys: Object.keys(data),
        studentNameValue: data.studentName,
      });

      // Use the same pattern as regular PDF generation
      window.studentData = data;
      // Also set a backup property
      window.injectedStudentData = data;

      // Dispatch custom event to notify React component
      window.dispatchEvent(
        new CustomEvent("studentDataLoaded", { detail: data })
      );
      console.log("✅ State diploma data injected and event dispatched");

      // Force a re-render by touching the DOM
      const event = new Event("resize");
      window.dispatchEvent(event);
    }, diplomaData);

    // Wait for the bulletin template to be fully rendered (using same selectors as regular PDF)
    console.log("⏳ Waiting for bulletin template to be ready...");

    // Try multiple selectors for state diploma template
    const selectors = [
      "#state-diploma-template",
      '[data-testid="state-diploma-template"]',
      "#bulletin-template", // Fallback for card-only page
    ];
    let templateFound = false;

    for (const selector of selectors) {
      try {
        console.log(`🔍 Trying selector: ${selector}`);
        await page.waitForSelector(selector, { timeout: 10000 }); // Increased timeout
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
      throw new Error("Could not find state diploma template on page");
    }

    // Additional check to ensure the content is actually rendered
    console.log("⏳ Verifying diploma content has loaded...");

    // Debug: Check current template state before waiting
    const templateState = await page.evaluate(() => {
      const stateDiplomaTemplate = document.querySelector(
        "#state-diploma-template"
      );
      const bulletinTemplate = document.querySelector("#bulletin-template");
      const template = stateDiplomaTemplate || bulletinTemplate;

      if (!template) return { found: false };

      const textContent = template.textContent || "";
      const htmlLength = template.innerHTML.length;

      return {
        found: true,
        templateType: stateDiplomaTemplate ? "state-diploma" : "bulletin",
        textContent: textContent.substring(0, 200), // First 200 chars
        htmlLength: htmlLength,
        hasStateDiploma: textContent.includes("STATE DIPLOMA"),
        hasBulletinContent: textContent.length > 100,
        containsText: textContent.trim().length > 0,
      };
    });

    console.log("📊 Template state before waiting:", templateState);

    await page.waitForFunction(
      () => {
        const stateDiplomaTemplate = document.querySelector(
          "#state-diploma-template"
        );
        const bulletinTemplate = document.querySelector("#bulletin-template");
        const template = stateDiplomaTemplate || bulletinTemplate;

        if (!template) {
          console.log("No template found");
          return false;
        }

        // Check if template has substantial content
        const templateText = template.textContent || "";
        const templateHTML = template.innerHTML || "";

        // For state diploma, check for diploma content
        if (stateDiplomaTemplate) {
          return templateText.length > 50 && templateHTML.length > 100;
        }

        // For bulletin template (card-only page with state diploma data), check for basic content
        if (bulletinTemplate) {
          return templateText.length > 100 && templateHTML.length > 1000;
        }

        return false;
      },
      { timeout: 10000, polling: 1000 }
    );

    console.log("✅ Template content has loaded successfully");

    // Isolate and optimize the diploma template for PDF rendering with explicit landscape orientation
    await page.evaluate(() => {
      // Hide everything first
      document.querySelectorAll("body > *").forEach((el) => {
        el.style.display = "none";
      });

      // Find the diploma template
      const diplomaElement = document.querySelector("#state-diploma-template");

      if (diplomaElement) {
        // Create a new container for the isolated diploma with landscape orientation
        const container = document.createElement("div");
        container.id = "pdf-diploma-container";
        container.style.position = "absolute";
        container.style.top = "0";
        container.style.left = "0";
        container.style.width = "100%";
        container.style.height = "100%";
        container.style.backgroundColor = "#f8f5e3"; // Match diploma background color
        container.style.overflow = "hidden";
        container.style.display = "flex";
        container.style.justifyContent = "center";
        container.style.alignItems = "center";

        // Set explicit landscape orientation with CSS
        container.style.pageOrientation = "landscape";
        document.body.style.width = "297mm"; // A4 width in landscape
        document.body.style.height = "210mm"; // A4 height in landscape
        document.body.style.margin = "0";
        document.body.style.padding = "0";
        document.body.style.overflow = "hidden";
        document.body.style.backgroundColor = "#f8f5e3"; // Match diploma background color

        // Add @page rule for landscape and background color
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
          /* Ensure border images are properly rendered */
          #state-diploma-template {
            border: 15px solid !important;
            border-image: repeating-linear-gradient(45deg, #ff6b6b, #ff6b6b 15px, #ff8a8a 15px, #ff8a8a 25px) 15 !important;
            -webkit-border-image: repeating-linear-gradient(45deg, #ff6b6b, #ff6b6b 15px, #ff8a8a 15px, #ff8a8a 25px) 15 !important;
          }
        `;
        document.head.appendChild(style);

        // Clone the diploma to avoid CSS inheritance issues
        const diplomaClone = diplomaElement.cloneNode(true);
        diplomaClone.style.margin = "0";
        diplomaClone.style.padding = "0";
        diplomaClone.style.boxShadow = "none";
        // Preserve the border and borderImage for PDF generation
        diplomaClone.style.border = "15px solid";
        diplomaClone.style.borderImage =
          "repeating-linear-gradient(45deg, #ff6b6b, #ff6b6b 15px, #ff8a8a 15px, #ff8a8a 25px) 15";
        diplomaClone.style.transform = "none";
        diplomaClone.style.transformOrigin = "center";
        diplomaClone.style.maxWidth = "100%";
        diplomaClone.style.maxHeight = "100%";
        diplomaClone.style.backgroundColor = "#f8f5e3"; // Match diploma background color

        // Add to our new container
        container.appendChild(diplomaClone);

        // Add the container to the body
        document.body.appendChild(container);

        console.log(
          "Diploma isolated and optimized for landscape PDF rendering with #f8f5e3 background"
        );

        // Reset scroll position
        window.scrollTo(0, 0);
      }
    });

    // Wait a moment for the DOM changes to take effect
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Set page media type and properties for PDF generation
    await page.emulateMediaType("screen");

    // Force landscape orientation through page evaluation
    await page.evaluate(() => {
      // Override matchMedia to force landscape orientation
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

      // Set background color to match the diploma template
      document.body.style.backgroundColor = "#f8f5e3";
      document.documentElement.style.backgroundColor = "#f8f5e3";

      // Force orientation through meta tag
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

    // Take a screenshot for debugging purposes
    await page.screenshot({
      path: "/tmp/diploma-before-pdf.png",
      fullPage: true,
    });
    console.log("📸 Pre-PDF screenshot saved to /tmp/diploma-before-pdf.png");

    // Generate PDF with simplified but explicitly forced landscape orientation and background color
    console.log(
      "📄 Generating PDF with explicit landscape orientation and #f8f5e3 background..."
    );
    const landscapePdfOptions = {
      format: "A4",
      landscape: true, // Force landscape orientation
      printBackground: true, // Print background graphics
      margin: {
        top: "5mm",
        bottom: "5mm",
        left: "5mm",
        right: "5mm",
      },
      preferCSSPageSize: false, // Disable CSS page size to force our settings
      scale: 0.9,
      omitBackground: false, // Don't omit background (default is false, but being explicit)
    };

    console.log("📄 Final PDF options:", landscapePdfOptions);

    const pdfBuffer = await page.pdf(landscapePdfOptions);

    // Set content disposition header for automatic download
    const studentName = diplomaData.studentName || "state_diploma";
    const cleanStudentName = studentName
      .replace(/[^a-zA-Z0-9]/g, "_")
      .toUpperCase();

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="STATE_DIPLOMA_${cleanStudentName}.pdf"`
    );
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdfBuffer.length);

    // Send the PDF
    console.log("✅ PDF generation successful, sending response");
    return res.end(pdfBuffer, "binary");
  } catch (error) {
    console.error("❌ Error generating state diploma PDF:", error);
    console.error("❌ Error stack:", error.stack);

    try {
      // Try to take a screenshot of the error state for debugging
      if (browser && page) {
        await page.screenshot({
          path: "/tmp/diploma-error.png",
          fullPage: true,
        });
        console.error(
          "📸 Error state screenshot saved to /tmp/diploma-error.png"
        );
      }
    } catch (screenshotError) {
      console.error("❌ Failed to take error screenshot:", screenshotError);
    }

    return res.status(500).json({
      error: "Failed to generate state diploma PDF",
      details: error.message,
      stack: error.stack,
    });
  } finally {
    // Ensure browser is closed in case of errors
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

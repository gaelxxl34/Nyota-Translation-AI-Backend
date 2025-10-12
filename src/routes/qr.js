// QR Code Generation Route for NTC
// Generates QR codes server-side for document verification

const express = require("express");
const QRCode = require("qrcode");
const verifyToken = require("../auth");

const router = express.Router();

/**
 * OPTIONS /api/qr/:documentId
 * Handle CORS preflight requests for mobile browsers
 */
router.options("/:documentId", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.status(204).send();
});

/**
 * GET /api/qr/:documentId
 * Generates a QR code image for document verification
 */
router.get("/:documentId", async (req, res) => {
  try {
    const { documentId } = req.params;

    if (!documentId) {
      return res.status(400).json({
        error: "Document ID is required",
      });
    }

    // Create verification URL
    const baseUrl = process.env.FRONTEND_URL || "https://nyotatranslate.com";
    const verificationUrl = `${baseUrl}/verify?doc=${documentId}`;

    console.log(`🔗 Generating QR code for document: ${documentId}`);
    console.log(`🔗 Verification URL: ${verificationUrl}`);
    console.log(`📱 User Agent: ${req.headers["user-agent"]}`);

    // Generate QR code options
    const options = {
      width: 300,
      margin: 1,
      color: {
        dark: "#000000", // Black QR code
        light: "#ffffff00", // Transparent background
      },
      errorCorrectionLevel: "M",
    };

    // Generate QR code as PNG buffer
    const qrBuffer = await QRCode.toBuffer(verificationUrl, options);

    // Set response headers for image with better mobile caching support
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", qrBuffer.length);

    // Improved caching and mobile-friendly headers
    res.setHeader(
      "Cache-Control",
      "public, max-age=86400, stale-while-revalidate=604800"
    ); // 24 hours cache, 7 days stale
    res.setHeader("ETag", `"qr-${documentId}"`);
    res.setHeader("Vary", "Accept-Encoding");

    // Mobile-specific headers
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Access-Control-Allow-Origin", "*"); // Allow all origins for QR codes
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "86400");

    // Send the QR code image
    res.send(qrBuffer);

    console.log(
      `✅ QR code generated successfully for document: ${documentId}`
    );
  } catch (error) {
    console.error("❌ Failed to generate QR code:", error);
    res.status(500).json({
      error: "Failed to generate QR code",
      details: error.message,
    });
  }
});

module.exports = router;

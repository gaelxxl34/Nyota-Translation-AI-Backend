// QR Code Generation Route for NTC
// Generates QR codes server-side for document verification

const express = require("express");
const QRCode = require("qrcode");
const verifyToken = require("../auth");

const router = express.Router();

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

    // Set response headers for image
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", qrBuffer.length);
    res.setHeader("Cache-Control", "public, max-age=3600"); // Cache for 1 hour

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

/**
 * GET /api/qr/:documentId/svg
 * Generates a QR code as SVG for document verification
 */
router.get("/:documentId/svg", async (req, res) => {
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

    console.log(`🔗 Generating SVG QR code for document: ${documentId}`);

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

    // Generate QR code as SVG string
    const svgString = await QRCode.toString(verificationUrl, {
      ...options,
      type: "svg",
    });

    // Set response headers for SVG
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=3600");

    // Send the SVG
    res.send(svgString);

    console.log(
      `✅ SVG QR code generated successfully for document: ${documentId}`
    );
  } catch (error) {
    console.error("❌ Failed to generate SVG QR code:", error);
    res.status(500).json({
      error: "Failed to generate SVG QR code",
      details: error.message,
    });
  }
});

/**
 * GET /api/qr/:documentId/data
 * Returns QR code data URL for embedding
 */
router.get("/:documentId/data", async (req, res) => {
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

    console.log(`🔗 Generating data URL QR code for document: ${documentId}`);

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

    // Generate QR code as data URL
    const dataURL = await QRCode.toDataURL(verificationUrl, options);

    // Return JSON with data URL
    res.json({
      documentId,
      verificationUrl,
      dataURL,
      timestamp: new Date().toISOString(),
    });

    console.log(
      `✅ Data URL QR code generated successfully for document: ${documentId}`
    );
  } catch (error) {
    console.error("❌ Failed to generate data URL QR code:", error);
    res.status(500).json({
      error: "Failed to generate data URL QR code",
      details: error.message,
    });
  }
});

module.exports = router;

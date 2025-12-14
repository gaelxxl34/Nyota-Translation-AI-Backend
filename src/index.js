// Nyota Translation Center (NTC) - Main Express Server
// Entry point for the backend API server

const express = require("express");
const cors = require("cors");
const path = require("path");

// Import configuration and utilities
const config = require("./config/env");

// Initialize Firebase Admin BEFORE importing routes that use Firestore
const { verifyToken, initializeFirebaseAdmin } = require("./auth");
initializeFirebaseAdmin();

// Now import routes that depend on Firebase
const uploadRoutes = require("./routes/upload");
const pdfRoutes = require("./routes/pdf");
const bulletinRoutes = require("./routes/bulletins");
const dashboardRoutes = require("./routes/dashboard");
const adminRoutes = require("./routes/admin");
const translatorRoutes = require("./routes/translator");
const partnerRoutes = require("./routes/partner");
const supportRoutes = require("./routes/support");
const stateDiplomaPdfRoutes = require("./routes/stateDiplomaPdf");
const stateExamAttestationPdfRoutes = require("./routes/stateExamAttestationPdf");
const bachelorDiplomaPdfRoutes = require("./routes/bachelorDiplomaPdf");
const collegeTranscriptPdfRoutes = require("./routes/collegeTranscriptPdf");
const collegeAttestationPdfRoutes = require("./routes/collegeAttestationPdf");
const highSchoolAttestationPdfRoutes = require("./routes/highSchoolAttestationPdf");
const qrRoutes = require("./routes/qr");

const app = express();

// Set server timeout for long-running operations like OpenAI processing
const server = require("http").createServer(app);
server.timeout = 300000; // 5 minutes timeout
server.keepAliveTimeout = 65000; // Keep alive timeout
server.headersTimeout = 66000; // Headers timeout (should be > keepAliveTimeout)

// Middleware setup
app.use(
  cors({
    origin: config.cors.origins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Request logging middleware
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.path} - ${new Date().toISOString()}`);
  if (req.headers.authorization) {
    console.log(
      `🔐 Auth header present: ${req.headers.authorization.substring(0, 20)}...`
    );
  }
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Set EJS as view engine for report card rendering
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "../views"));

// Serve static files for testing
app.use("/static", express.static(path.join(__dirname, "../public")));

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "OK", message: "NTC Backend is running" });
});

// Test endpoint to verify Firebase Admin setup (no auth required)
app.get("/api/test", (req, res) => {
  res.status(200).json({
    message: "Backend API is working",
    timestamp: new Date().toISOString(),
    firebase: "Ready for authentication",
  });
});

// API routes
app.use("/api/upload", uploadRoutes);
app.use("/api", pdfRoutes);
app.use("/api", stateDiplomaPdfRoutes);
app.use("/api", stateExamAttestationPdfRoutes);
app.use("/api", bachelorDiplomaPdfRoutes);
app.use("/api", collegeTranscriptPdfRoutes);
app.use("/api", collegeAttestationPdfRoutes);
app.use("/api", highSchoolAttestationPdfRoutes);
app.use("/api/qr", qrRoutes); // QR code generation routes (public - no auth required)
app.use("/api", verifyToken, bulletinRoutes); // Protected bulletin routes
app.use("/api", verifyToken, dashboardRoutes); // Protected dashboard routes
app.use("/api/admin", adminRoutes); // Admin routes (auth handled inside routes)
app.use("/api/translator", translatorRoutes); // Translator routes (auth handled inside routes)
app.use("/api/partner", partnerRoutes); // Partner routes (auth handled inside routes)
app.use("/api/support", supportRoutes); // Support routes (auth handled inside routes)

// Protected route - requires Firebase authentication
app.get("/api/profile", verifyToken, (req, res) => {
  try {
    res.status(200).json({
      message: "Protected route accessed successfully",
      user: {
        uid: req.user.uid,
        email: req.user.email,
        emailVerified: req.user.emailVerified,
        name: req.user.name,
        picture: req.user.picture,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("🚨 Error in /api/profile:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Start server
server.listen(config.server.port, () => {
  console.log(`🚀 NTC Backend server running on port ${config.server.port}`);
  console.log(`🌍 Environment: ${config.server.nodeEnv}`);
  console.log(`⏱️ Server timeout: ${server.timeout}ms`);
});

module.exports = app;

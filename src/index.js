// Nyota Translation Center (NTC) - Main Express Server
// Entry point for the backend API server

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");

// Import routes and middleware
const { verifyToken } = require("./auth");
const uploadRoutes = require("./routes/upload");
const pdfRoutes = require("./routes/pdf");
const bulletinRoutes = require("./routes/bulletins");

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware setup
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:3000",
    ],
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
app.use("/api", verifyToken, bulletinRoutes); // Protected bulletin routes

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
app.listen(PORT, () => {
  console.log(`🚀 NTC Backend server running on port ${PORT}`);
});

module.exports = app;

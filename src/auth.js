// Firebase Authentication Middleware for NTC
// Verifies Firebase ID tokens from client requests

const admin = require("firebase-admin");
const path = require("path");

// Initialize Firebase Admin SDK
let firebaseInitialized = false;

const initializeFirebaseAdmin = () => {
  if (firebaseInitialized) return;

  try {
    // Check if service account key path is provided
    const serviceAccountPath = process.env.SERVICE_ACCOUNT_KEY_PATH;

    if (serviceAccountPath) {
      // Resolve path relative to backend root directory
      const resolvedPath = path.resolve(__dirname, "..", serviceAccountPath);
      console.log(`🔍 Looking for service account key at: ${resolvedPath}`);

      // Initialize using service account key file
      const serviceAccount = require(resolvedPath);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID,
      });
      console.log("🔥 Firebase Admin initialized with service account key");
    } else {
      // Initialize using environment variables
      const serviceAccount = {
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      };

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID,
      });
      console.log("🔥 Firebase Admin initialized with environment variables");
    }

    firebaseInitialized = true;
  } catch (error) {
    console.error("🚨 Failed to initialize Firebase Admin:", error.message);
    throw new Error("Firebase Admin initialization failed");
  }
};

/**
 * Middleware to verify Firebase ID token from Authorization header
 * Attaches decoded user information to req.user
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @param {import('express').NextFunction} next - Express next function
 */
const verifyToken = async (req, res, next) => {
  try {
    // Initialize Firebase Admin if not already done
    if (!firebaseInitialized) {
      initializeFirebaseAdmin();
    }

    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Unauthorized: Missing or invalid Authorization header",
        details: "Expected format: 'Bearer <ID_TOKEN>'",
      });
    }

    const idToken = authHeader.split("Bearer ")[1];
    if (!idToken) {
      return res.status(401).json({
        error: "Unauthorized: No token provided",
      });
    }

    // Verify token using Firebase Admin SDK
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    // Attach decoded user to req.user
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified,
      name: decodedToken.name,
      picture: decodedToken.picture,
      authTime: decodedToken.auth_time,
      exp: decodedToken.exp,
      iat: decodedToken.iat,
    };

    console.log(
      `🔐 Token verified for user: ${req.user.email} (${req.user.uid})`
    );
    next();
  } catch (error) {
    console.error("🚨 Token verification failed:", error.message);

    // Handle specific Firebase Auth errors
    if (error.code === "auth/id-token-expired") {
      return res.status(401).json({
        error: "Unauthorized: Token expired",
        code: "TOKEN_EXPIRED",
      });
    } else if (error.code === "auth/id-token-revoked") {
      return res.status(401).json({
        error: "Unauthorized: Token revoked",
        code: "TOKEN_REVOKED",
      });
    } else if (error.code === "auth/invalid-id-token") {
      return res.status(401).json({
        error: "Unauthorized: Invalid token",
        code: "INVALID_TOKEN",
      });
    }

    // Generic error response
    res.status(401).json({
      error: "Unauthorized: Token verification failed",
      code: "VERIFICATION_FAILED",
    });
  }
};

module.exports = {
  verifyToken,
  initializeFirebaseAdmin,
};

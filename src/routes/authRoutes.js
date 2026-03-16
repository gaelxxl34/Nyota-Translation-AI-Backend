// Authentication Routes for NTC
// Handles user registration with email verification via SendGrid

const express = require("express");
const admin = require("firebase-admin");
const { sendVerificationEmail } = require("../services/emailService");

const router = express.Router();

/**
 * POST /api/auth/register
 * Creates a new user account and sends a verification email
 */
router.post("/register", async (req, res) => {
  try {
    const { email, password, displayName } = req.body;

    // Validate required fields
    if (!email || !password || !displayName) {
      return res.status(400).json({
        error: "Missing required fields",
        details: "email, password, and displayName are required",
        code: "MISSING_FIELDS",
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: "Invalid email format",
        code: "INVALID_EMAIL",
      });
    }

    // Validate password strength
    if (password.length < 6) {
      return res.status(400).json({
        error: "Password must be at least 6 characters",
        code: "WEAK_PASSWORD",
      });
    }

    // Validate display name
    const trimmedName = displayName.trim();
    if (trimmedName.length < 2 || trimmedName.length > 100) {
      return res.status(400).json({
        error: "Display name must be between 2 and 100 characters",
        code: "INVALID_NAME",
      });
    }

    console.log(`📝 Registration attempt for: ${email}`);

    // Create user in Firebase Auth (emailVerified defaults to false)
    let userRecord;
    try {
      userRecord = await admin.auth().createUser({
        email,
        password,
        displayName: trimmedName,
        emailVerified: false,
      });
    } catch (authError) {
      if (authError.code === "auth/email-already-exists") {
        return res.status(409).json({
          error: "An account with this email already exists",
          code: "EMAIL_EXISTS",
        });
      }
      if (authError.code === "auth/invalid-password") {
        return res.status(400).json({
          error: "Password must be at least 6 characters",
          code: "WEAK_PASSWORD",
        });
      }
      throw authError;
    }

    // Create user record in Firestore
    const db = admin.firestore();
    await db.collection("users").doc(userRecord.uid).set({
      uid: userRecord.uid,
      email,
      displayName: trimmedName,
      role: "user",
      permissions: [],
      isActive: true,
      emailVerified: false,
      partnerId: null,
      partnerName: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastLogin: null,
      preferences: {
        language: "en",
        notifications: true,
        emailAlerts: true,
      },
    });

    // Generate Firebase email verification link
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const actionCodeSettings = {
      url: `${frontendUrl}/login?verified=true`,
      handleCodeInApp: false,
    };

    const verificationLink = await admin
      .auth()
      .generateEmailVerificationLink(email, actionCodeSettings);

    // Send branded verification email via SendGrid
    await sendVerificationEmail(email, trimmedName, verificationLink);

    console.log(`✅ User registered: ${email} (${userRecord.uid})`);

    res.status(201).json({
      message: "Account created successfully. Please check your email to verify your account.",
      uid: userRecord.uid,
      email,
    });
  } catch (error) {
    console.error("🚨 Registration error:", error.message);
    res.status(500).json({
      error: "Failed to create account. Please try again.",
      code: "REGISTRATION_FAILED",
    });
  }
});

/**
 * POST /api/auth/resend-verification
 * Resends the verification email for an unverified account
 */
router.post("/resend-verification", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: "Email is required",
        code: "MISSING_EMAIL",
      });
    }

    // Look up user by email
    let userRecord;
    try {
      userRecord = await admin.auth().getUserByEmail(email);
    } catch (err) {
      // Don't reveal whether the email exists
      return res.status(200).json({
        message: "If an account exists with this email, a verification link has been sent.",
      });
    }

    // If already verified, no need to resend
    if (userRecord.emailVerified) {
      return res.status(200).json({
        message: "If an account exists with this email, a verification link has been sent.",
      });
    }

    // Generate new verification link
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const actionCodeSettings = {
      url: `${frontendUrl}/login?verified=true`,
      handleCodeInApp: false,
    };

    const verificationLink = await admin
      .auth()
      .generateEmailVerificationLink(email, actionCodeSettings);

    // Send verification email
    await sendVerificationEmail(
      email,
      userRecord.displayName || "there",
      verificationLink
    );

    console.log(`📧 Verification email resent to: ${email}`);

    res.status(200).json({
      message: "If an account exists with this email, a verification link has been sent.",
    });
  } catch (error) {
    console.error("🚨 Resend verification error:", error.message);
    res.status(500).json({
      error: "Failed to resend verification email. Please try again.",
      code: "RESEND_FAILED",
    });
  }
});

module.exports = router;

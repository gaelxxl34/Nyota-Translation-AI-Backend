#!/usr/bin/env node
// Super Admin Seeding Script for NTC
// Creates or updates a super admin account
// Usage: node scripts/seedSuperAdmin.js [email]

require("dotenv").config();
const admin = require("firebase-admin");
const path = require("path");
const readline = require("readline");

// Initialize Firebase Admin
const initializeFirebase = () => {
  const serviceAccountPath = process.env.SERVICE_ACCOUNT_KEY_PATH;

  if (serviceAccountPath) {
    const resolvedPath = path.resolve(__dirname, "..", serviceAccountPath);
    const serviceAccount = require(resolvedPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
  } else {
    const serviceAccount = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    };
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
  }
  console.log("🔥 Firebase Admin initialized");
};

// Prompt for user input
const prompt = (question) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
};

// Create super admin user
const createSuperAdmin = async (email, password, displayName) => {
  const db = admin.firestore();

  try {
    let uid;
    let userRecord;

    // Check if user already exists in Firebase Auth
    try {
      userRecord = await admin.auth().getUserByEmail(email);
      uid = userRecord.uid;
      console.log(`📧 User already exists in Firebase Auth: ${email} (${uid})`);
    } catch (error) {
      if (error.code === "auth/user-not-found") {
        // Create new Firebase Auth user
        userRecord = await admin.auth().createUser({
          email,
          password,
          displayName,
          emailVerified: true,
        });
        uid = userRecord.uid;
        console.log(`✅ Created Firebase Auth user: ${email} (${uid})`);
      } else {
        throw error;
      }
    }

    // Set custom claims for super admin role
    await admin.auth().setCustomUserClaims(uid, {
      role: "superadmin",
      permissions: [],
    });
    console.log(`✅ Set custom claims: role=superadmin`);

    // Create or update Firestore user document
    const userRef = db.collection("users").doc(uid);
    const existingUser = await userRef.get();

    const userData = {
      uid,
      email,
      displayName,
      role: "superadmin",
      permissions: [],
      isActive: true,
      partnerId: null,
      partnerName: null,
      preferences: {
        language: "en",
        notifications: true,
        emailAlerts: true,
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (existingUser.exists) {
      await userRef.update(userData);
      console.log(`✅ Updated Firestore user document`);
    } else {
      await userRef.set({
        ...userData,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: "system_seed",
      });
      console.log(`✅ Created Firestore user document`);
    }

    console.log("\n" + "=".repeat(50));
    console.log("🎉 SUPER ADMIN ACCOUNT READY!");
    console.log("=".repeat(50));
    console.log(`Email: ${email}`);
    console.log(`UID: ${uid}`);
    console.log(`Role: superadmin`);
    console.log("=".repeat(50));

    return { uid, email, role: "superadmin" };
  } catch (error) {
    console.error("❌ Error creating super admin:", error.message);
    throw error;
  }
};

// Upgrade existing user to super admin
const upgradeTosuperAdmin = async (email) => {
  const db = admin.firestore();

  try {
    // Get user by email
    const userRecord = await admin.auth().getUserByEmail(email);
    const uid = userRecord.uid;

    console.log(`📧 Found user: ${email} (${uid})`);

    // Set custom claims
    await admin.auth().setCustomUserClaims(uid, {
      role: "superadmin",
      permissions: [],
    });
    console.log(`✅ Updated custom claims: role=superadmin`);

    // Update Firestore document
    const userRef = db.collection("users").doc(uid);
    await userRef.set(
      {
        uid,
        email,
        role: "superadmin",
        permissions: [],
        isActive: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    console.log(`✅ Updated Firestore document`);

    console.log("\n" + "=".repeat(50));
    console.log("🎉 USER UPGRADED TO SUPER ADMIN!");
    console.log("=".repeat(50));
    console.log(`Email: ${email}`);
    console.log(`UID: ${uid}`);
    console.log("=".repeat(50));
    console.log(
      "\n⚠️  User must log out and log back in for changes to take effect."
    );

    return { uid, email, role: "superadmin" };
  } catch (error) {
    if (error.code === "auth/user-not-found") {
      console.log(`❌ User not found: ${email}`);
      console.log("Would you like to create a new super admin account?");
    }
    throw error;
  }
};

// List all super admins
const listSuperAdmins = async () => {
  const db = admin.firestore();

  try {
    const snapshot = await db
      .collection("users")
      .where("role", "==", "superadmin")
      .get();

    if (snapshot.empty) {
      console.log("📭 No super admin accounts found.");
      return [];
    }

    console.log("\n" + "=".repeat(50));
    console.log("📋 SUPER ADMIN ACCOUNTS");
    console.log("=".repeat(50));

    const admins = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      console.log(`  • ${data.email || "N/A"} (${doc.id})`);
      console.log(`    Active: ${data.isActive !== false ? "Yes" : "No"}`);
      admins.push({ id: doc.id, ...data });
    });

    console.log("=".repeat(50));
    console.log(`Total: ${admins.length} super admin(s)`);

    return admins;
  } catch (error) {
    console.error("❌ Error listing super admins:", error.message);
    throw error;
  }
};

// Main function
const main = async () => {
  initializeFirebase();

  const args = process.argv.slice(2);
  const command = args[0];

  console.log("\n🔐 NTC Super Admin Management Tool\n");

  if (command === "list") {
    // List all super admins
    await listSuperAdmins();
  } else if (command === "upgrade" && args[1]) {
    // Upgrade existing user to super admin
    await upgradeTosuperAdmin(args[1]);
  } else if (command === "create") {
    // Interactive creation
    console.log("Creating a new Super Admin account...\n");

    const email = args[1] || (await prompt("Email: "));
    const password = args[2] || (await prompt("Password (min 6 chars): "));
    const displayName = args[3] || (await prompt("Display Name: "));

    if (!email || !password || !displayName) {
      console.error("❌ All fields are required.");
      process.exit(1);
    }

    if (password.length < 6) {
      console.error("❌ Password must be at least 6 characters.");
      process.exit(1);
    }

    await createSuperAdmin(email, password, displayName);
  } else {
    // Show help
    console.log("Usage:");
    console.log(
      "  node scripts/seedSuperAdmin.js create [email] [password] [displayName]"
    );
    console.log("  node scripts/seedSuperAdmin.js upgrade <email>");
    console.log("  node scripts/seedSuperAdmin.js list");
    console.log("\nExamples:");
    console.log(
      "  node scripts/seedSuperAdmin.js create admin@ntc.com password123 'Admin User'"
    );
    console.log("  node scripts/seedSuperAdmin.js upgrade existing@user.com");
    console.log("  node scripts/seedSuperAdmin.js list");
  }

  process.exit(0);
};

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

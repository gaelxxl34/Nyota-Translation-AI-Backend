// User Service for NTC
// Handles user CRUD operations with role management

const admin = require("firebase-admin");
const { ROLES, ROLE_HIERARCHY } = require("../middleware/rbac");

/**
 * Get Firestore database instance
 * @returns {FirebaseFirestore.Firestore}
 */
const getDb = () => admin.firestore();

/**
 * Get a user by UID
 * @param {string} uid - User's Firebase UID
 * @returns {Promise<Object|null>}
 */
const getUserById = async (uid) => {
  try {
    const db = getDb();
    const userDoc = await db.collection("users").doc(uid).get();

    if (!userDoc.exists) {
      return null;
    }

    return { id: userDoc.id, ...userDoc.data() };
  } catch (error) {
    console.error(`❌ Error fetching user ${uid}:`, error);
    throw error;
  }
};

/**
 * Get a user by email
 * @param {string} email - User's email
 * @returns {Promise<Object|null>}
 */
const getUserByEmail = async (email) => {
  try {
    const db = getDb();
    const snapshot = await db
      .collection("users")
      .where("email", "==", email)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() };
  } catch (error) {
    console.error(`❌ Error fetching user by email ${email}:`, error);
    throw error;
  }
};

/**
 * Create or update a user in Firestore
 * @param {string} uid - User's Firebase UID
 * @param {Object} userData - User data
 * @param {string} createdBy - UID of the user creating this account (for admin-created accounts)
 * @returns {Promise<Object>}
 */
const createOrUpdateUser = async (uid, userData, createdBy = null) => {
  try {
    const db = getDb();
    const userRef = db.collection("users").doc(uid);
    const existingUser = await userRef.get();

    const now = admin.firestore.FieldValue.serverTimestamp();

    if (existingUser.exists) {
      // Update existing user
      const updateData = {
        ...userData,
        updatedAt: now,
      };

      // Don't overwrite certain fields on update
      delete updateData.createdAt;
      delete updateData.createdBy;

      await userRef.update(updateData);
      console.log(`✅ Updated user: ${userData.email || uid}`);

      const updated = await userRef.get();
      return { id: updated.id, ...updated.data() };
    } else {
      // Create new user
      const newUser = {
        uid,
        email: userData.email || null,
        displayName: userData.displayName || null,
        phoneNumber: userData.phoneNumber || null,
        photoURL: userData.photoURL || null,
        role: userData.role || ROLES.USER,
        permissions: userData.permissions || [],
        isActive: true,
        partnerId: userData.partnerId || null,
        partnerName: userData.partnerName || null,
        createdAt: now,
        createdBy: createdBy,
        updatedAt: now,
        lastLogin: now,
        preferences: {
          language: "en",
          notifications: true,
          emailAlerts: true,
        },
        ...userData,
      };

      await userRef.set(newUser);
      console.log(
        `✅ Created user: ${newUser.email || uid} with role: ${newUser.role}`
      );

      return { id: uid, ...newUser };
    }
  } catch (error) {
    console.error(`❌ Error creating/updating user:`, error);
    throw error;
  }
};

/**
 * Update user's role
 * @param {string} uid - User's UID
 * @param {string} newRole - New role to assign
 * @param {string} assignedBy - UID of admin assigning the role
 * @returns {Promise<Object>}
 */
const updateUserRole = async (uid, newRole, assignedBy) => {
  try {
    // Validate role
    if (!Object.values(ROLES).includes(newRole)) {
      throw new Error(`Invalid role: ${newRole}`);
    }

    const db = getDb();
    const userRef = db.collection("users").doc(uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      throw new Error(`User not found: ${uid}`);
    }

    const previousRole = userDoc.data().role;

    await userRef.update({
      role: newRole,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      roleHistory: admin.firestore.FieldValue.arrayUnion({
        from: previousRole,
        to: newRole,
        changedBy: assignedBy,
        changedAt: new Date().toISOString(),
      }),
    });

    console.log(`✅ Updated role for ${uid}: ${previousRole} → ${newRole}`);

    // Also update Firebase Auth custom claims for role
    await admin.auth().setCustomUserClaims(uid, { role: newRole });
    console.log(`✅ Updated custom claims for ${uid}`);

    const updated = await userRef.get();
    return { id: updated.id, ...updated.data() };
  } catch (error) {
    console.error(`❌ Error updating user role:`, error);
    throw error;
  }
};

/**
 * Get all users with optional filters
 * @param {Object} filters - Filter options
 * @param {string} filters.role - Filter by role
 * @param {string} filters.partnerId - Filter by partner
 * @param {boolean} filters.isActive - Filter by active status
 * @param {number} filters.limit - Max results
 * @param {string} filters.startAfter - Pagination cursor
 * @returns {Promise<Object[]>}
 */
const getUsers = async (filters = {}) => {
  try {
    const db = getDb();
    let query = db.collection("users");

    if (filters.role) {
      query = query.where("role", "==", filters.role);
    }

    if (filters.partnerId) {
      query = query.where("partnerId", "==", filters.partnerId);
    }

    if (typeof filters.isActive === "boolean") {
      query = query.where("isActive", "==", filters.isActive);
    }

    query = query.orderBy("createdAt", "desc");

    if (filters.limit) {
      query = query.limit(filters.limit);
    }

    if (filters.startAfter) {
      const startDoc = await db
        .collection("users")
        .doc(filters.startAfter)
        .get();
      if (startDoc.exists) {
        query = query.startAfter(startDoc);
      }
    }

    const snapshot = await query.get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error(`❌ Error fetching users:`, error);
    throw error;
  }
};

/**
 * Get users by role
 * @param {string} role - Role to filter by
 * @returns {Promise<Object[]>}
 */
const getUsersByRole = async (role) => {
  return getUsers({ role, isActive: true });
};

/**
 * Get users by partner
 * @param {string} partnerId - Partner ID
 * @returns {Promise<Object[]>}
 */
const getUsersByPartner = async (partnerId) => {
  return getUsers({ partnerId, isActive: true });
};

/**
 * Deactivate a user (soft delete)
 * @param {string} uid - User's UID
 * @param {string} deactivatedBy - UID of admin deactivating
 * @returns {Promise<Object>}
 */
const deactivateUser = async (uid, deactivatedBy) => {
  try {
    const db = getDb();
    const userRef = db.collection("users").doc(uid);

    await userRef.update({
      isActive: false,
      deactivatedAt: admin.firestore.FieldValue.serverTimestamp(),
      deactivatedBy: deactivatedBy,
    });

    // Disable in Firebase Auth
    await admin.auth().updateUser(uid, { disabled: true });

    console.log(`✅ Deactivated user: ${uid}`);

    const updated = await userRef.get();
    return { id: updated.id, ...updated.data() };
  } catch (error) {
    console.error(`❌ Error deactivating user:`, error);
    throw error;
  }
};

/**
 * Reactivate a user
 * @param {string} uid - User's UID
 * @param {string} reactivatedBy - UID of admin reactivating
 * @returns {Promise<Object>}
 */
const reactivateUser = async (uid, reactivatedBy) => {
  try {
    const db = getDb();
    const userRef = db.collection("users").doc(uid);

    await userRef.update({
      isActive: true,
      reactivatedAt: admin.firestore.FieldValue.serverTimestamp(),
      reactivatedBy: reactivatedBy,
    });

    // Enable in Firebase Auth
    await admin.auth().updateUser(uid, { disabled: false });

    console.log(`✅ Reactivated user: ${uid}`);

    const updated = await userRef.get();
    return { id: updated.id, ...updated.data() };
  } catch (error) {
    console.error(`❌ Error reactivating user:`, error);
    throw error;
  }
};

/**
 * Update user's last login timestamp
 * @param {string} uid - User's UID
 * @returns {Promise<void>}
 */
const updateLastLogin = async (uid) => {
  try {
    const db = getDb();
    await db.collection("users").doc(uid).update({
      lastLogin: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    // Don't throw - this is not critical
    console.warn(`⚠️ Could not update last login for ${uid}:`, error.message);
  }
};

/**
 * Get user statistics
 * @returns {Promise<Object>}
 */
const getUserStats = async () => {
  try {
    const db = getDb();
    const usersSnapshot = await db.collection("users").get();

    const stats = {
      total: usersSnapshot.size,
      byRole: {},
      active: 0,
      inactive: 0,
    };

    usersSnapshot.forEach((doc) => {
      const data = doc.data();
      const role = data.role || ROLES.USER;

      // Count by role
      stats.byRole[role] = (stats.byRole[role] || 0) + 1;

      // Count active/inactive
      if (data.isActive !== false) {
        stats.active++;
      } else {
        stats.inactive++;
      }
    });

    return stats;
  } catch (error) {
    console.error(`❌ Error getting user stats:`, error);
    throw error;
  }
};

/**
 * Create a user account with Firebase Auth and Firestore
 * For admin-created accounts (translators, partners, support)
 * @param {Object} userData - User data
 * @param {string} createdBy - UID of admin creating the account
 * @returns {Promise<Object>}
 */
const createUserAccount = async (userData, createdBy) => {
  try {
    const {
      email,
      password,
      displayName,
      role,
      partnerId,
      partnerName,
      phoneNumber,
    } = userData;

    // Create Firebase Auth user
    const authUser = await admin.auth().createUser({
      email,
      password,
      displayName,
      phoneNumber: phoneNumber || undefined,
      emailVerified: false,
      disabled: false,
    });

    console.log(`✅ Created Firebase Auth user: ${authUser.uid}`);

    // Set custom claims for role
    await admin.auth().setCustomUserClaims(authUser.uid, { role });
    console.log(`✅ Set custom claims for ${authUser.uid}: role=${role}`);

    // Create Firestore user document
    const firestoreUser = await createOrUpdateUser(
      authUser.uid,
      {
        email,
        displayName,
        phoneNumber,
        role,
        partnerId,
        partnerName,
      },
      createdBy
    );

    return firestoreUser;
  } catch (error) {
    console.error(`❌ Error creating user account:`, error);
    throw error;
  }
};

module.exports = {
  getUserById,
  getUserByEmail,
  createOrUpdateUser,
  updateUserRole,
  getUsers,
  getUsersByRole,
  getUsersByPartner,
  deactivateUser,
  reactivateUser,
  updateLastLogin,
  getUserStats,
  createUserAccount,
};

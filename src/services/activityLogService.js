// Activity Log Service for NTC
// Records and retrieves admin/system activity audit trail

const admin = require("firebase-admin");
const { cache, TTL, keys } = require("./cache");

const COLLECTION = "activityLogs";

/**
 * Log an activity event
 * @param {Object} params
 * @param {string} params.action - Action type (e.g., 'user.create', 'partner.update')
 * @param {string} params.performedBy - UID of user who performed the action
 * @param {string} [params.performedByEmail] - Email of user who performed the action
 * @param {string} [params.targetId] - ID of the entity affected
 * @param {string} [params.targetType] - Type of entity ('user', 'partner', 'document', 'system')
 * @param {string} [params.description] - Human-readable description
 * @param {Object} [params.metadata] - Additional context data
 */
async function logActivity({
  action,
  performedBy,
  performedByEmail,
  targetId,
  targetType,
  description,
  metadata,
}) {
  try {
    const db = admin.firestore();
    await db.collection(COLLECTION).add({
      action,
      performedBy,
      performedByEmail: performedByEmail || null,
      targetId: targetId || null,
      targetType: targetType || null,
      description: description || null,
      metadata: metadata || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Invalidate cached log queries so new entries appear
    await cache.invalidatePrefix("activityLogs:");
  } catch (error) {
    // Fire-and-forget: don't let log failures break the app
    console.error("⚠️ Failed to write activity log:", error.message);
  }
}

/**
 * Get activity logs with filters and pagination
 * @param {Object} filters
 * @param {string} [filters.action] - Filter by action type prefix (e.g., 'user')
 * @param {string} [filters.performedBy] - Filter by user UID
 * @param {string} [filters.targetType] - Filter by target type
 * @param {number} [filters.limit] - Max results (default 50)
 * @param {string} [filters.startAfter] - Firestore doc ID for pagination
 * @returns {Promise<Array>}
 */
async function getLogs(filters = {}) {
  // Build a cache key from the filter params (excluding pagination for cache-friendliness)
  const filterHash = `${filters.action || ""}:${filters.performedBy || ""}:${filters.targetType || ""}:${filters.limit || 50}:${filters.startAfter || ""}`;
  const cacheKey = keys.activityLogs(filterHash);

  return cache.getOrSet(cacheKey, TTL.LIST, async () => {
    const db = admin.firestore();
    let query = db.collection(COLLECTION).orderBy("createdAt", "desc");

    if (filters.action) {
      query = query
        .where("action", ">=", filters.action)
        .where("action", "<=", filters.action + "\uf8ff");
    }

    if (filters.performedBy) {
      query = query.where("performedBy", "==", filters.performedBy);
    }

    if (filters.targetType) {
      query = query.where("targetType", "==", filters.targetType);
    }

    const limit = Math.min(filters.limit || 50, 200);
    query = query.limit(limit);

    if (filters.startAfter) {
      const startDoc = await db
        .collection(COLLECTION)
        .doc(filters.startAfter)
        .get();
      if (startDoc.exists) {
        query = query.startAfter(startDoc);
      }
    }

    const snapshot = await query.get();

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.()
          ? data.createdAt.toDate().toISOString()
          : data.createdAt,
      };
    });
  });
}

module.exports = { logActivity, getLogs };

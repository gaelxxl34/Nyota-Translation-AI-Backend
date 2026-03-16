// Redis Cache Service for NTC
// Reduces Firestore reads by caching frequently accessed documents
// Uses ioredis with JSON serialization — production-grade caching

const Redis = require("ioredis");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    if (times > 5) return null; // stop retrying
    return Math.min(times * 200, 2000);
  },
  lazyConnect: true,
});

let connected = false;

redis.on("connect", () => {
  connected = true;
  console.log("✅ Redis connected");
});

redis.on("error", (err) => {
  connected = false;
  console.error("❌ Redis error:", err.message);
});

redis.on("close", () => {
  connected = false;
});

// Connect eagerly but don't block startup
redis.connect().catch((err) => {
  console.warn("⚠️ Redis not available, falling back to in-memory cache:", err.message);
});

// In-memory fallback when Redis is unavailable
const memFallback = new Map();

class CacheService {
  /**
   * Get a cached value by key. Returns null if missing or expired.
   */
  async get(key) {
    try {
      if (connected) {
        const raw = await redis.get(key);
        return raw ? JSON.parse(raw) : null;
      }
    } catch (e) { /* fall through */ }
    // In-memory fallback
    const entry = memFallback.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.exp) { memFallback.delete(key); return null; }
    return entry.val;
  }

  /**
   * Store a value with TTL in milliseconds.
   */
  async set(key, value, ttlMs) {
    const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
    try {
      if (connected) {
        await redis.set(key, JSON.stringify(value), "EX", ttlSec);
        return;
      }
    } catch (e) { /* fall through */ }
    memFallback.set(key, { val: value, exp: Date.now() + ttlMs });
  }

  /**
   * Delete a specific key (use after writes/updates).
   */
  async del(key) {
    try {
      if (connected) { await redis.del(key); return; }
    } catch (e) { /* fall through */ }
    memFallback.delete(key);
  }

  /**
   * Invalidate all keys matching a prefix (e.g. "user:" or "bulletin:").
   * Uses SCAN in Redis to avoid blocking.
   */
  async invalidatePrefix(prefix) {
    try {
      if (connected) {
        let cursor = "0";
        do {
          const [next, foundKeys] = await redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 100);
          cursor = next;
          if (foundKeys.length > 0) await redis.del(...foundKeys);
        } while (cursor !== "0");
        return;
      }
    } catch (e) { /* fall through */ }
    for (const k of memFallback.keys()) {
      if (k.startsWith(prefix)) memFallback.delete(k);
    }
  }

  /**
   * Get-or-set pattern: returns cached value, or calls fetchFn and caches the result.
   */
  async getOrSet(key, ttlMs, fetchFn) {
    const cached = await this.get(key);
    if (cached !== null) return cached;

    const value = await fetchFn();
    if (value !== null && value !== undefined) {
      await this.set(key, value, ttlMs);
    }
    return value;
  }
}

// TTL presets (milliseconds)
const TTL = {
  USER: 5 * 60_000,         // 5 min — user profiles (role, permissions)
  DOCUMENT: 2 * 60_000,     // 2 min — bulletin/certified doc data
  LIST: 30_000,              // 30 sec — document listings
  QUEUE: 15_000,             // 15 sec — translator queue (needs freshness)
  STATS: 30_000,             // 30 sec — dashboard stats
  VERIFICATION: 10 * 60_000, // 10 min — public document verification (rarely changes)
  PARTNER: 5 * 60_000,      // 5 min — partner profiles
  ANALYTICS: 60_000,        // 1 min — analytics/dashboard aggregates
  CONVERSATION: 30_000,     // 30 sec — support conversations
  TEMPLATE: 5 * 60_000,     // 5 min — message templates (rarely change)
};

// Key builders — ensure consistent key naming
const keys = {
  user: (uid) => `user:${uid}`,
  bulletin: (id) => `bulletin:${id}`,
  certDoc: (id) => `certDoc:${id}`,
  userBulletins: (uid) => `userBulletins:${uid}`,
  userCertDocs: (uid, status) => `userCertDocs:${uid}:${status || "all"}`,
  queue: (status) => `queue:${status || "all"}`,
  verification: (certId) => `verification:${certId}`,
  partner: (id) => `partner:${id}`,
  allPartners: () => `partners:all`,
  partnerDocs: (partnerId, extra) => `partnerDocs:${partnerId}:${extra || "all"}`,
  dashboardStats: (scope) => `dashboard:${scope}`,
  queueStats: () => `queueStats`,
  translatorStats: (uid) => `translatorStats:${uid}`,
  translatorLeaderboard: () => `translatorLeaderboard`,
  supportStats: () => `supportStats`,
  supportConversations: (status) => `supportConvos:${status || "all"}`,
  conversation: (id) => `conversation:${id}`,
  conversationMsgs: (id) => `conversationMsgs:${id}`,
  agentStats: (uid) => `agentStats:${uid}`,
  supportTeam: () => `supportTeam`,
  messageTemplates: () => `messageTemplates`,
  bulletinCheck: (bulletinId, uid) => `bulletinCheck:${bulletinId}:${uid}`,
  adminAnalytics: () => `adminAnalytics`,
  doc: (id) => `doc:${id}`,
  userDocs: (uid) => `userDocs:${uid}`,
  userStats: () => `userStats`,
  activeTranslators: () => `activeTranslators`,
  activeSupportAgents: () => `activeSupportAgents`,
  activityLogs: (hash) => `activityLogs:${hash}`,
};

// Singleton instance shared across the app
const cache = new CacheService();

module.exports = { cache, TTL, keys };

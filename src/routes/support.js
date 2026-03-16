// Support Agent Routes for NTC
// Handles WhatsApp conversations, user support, and document delivery

const express = require("express");
const { verifyToken } = require("../auth");
const {
  ROLES,
  PERMISSIONS,
  requireRole,
  requirePermission,
  attachRoleInfo,
} = require("../middleware/rbac");
const admin = require("firebase-admin");
const { cache, TTL, keys } = require("../services/cache");

const router = express.Router();
const db = admin.firestore();

// Apply role info middleware to all support routes
router.use(attachRoleInfo());

// ============================================
// WHATSAPP CONVERSATIONS ROUTES
// ============================================

/**
 * GET /api/support/conversations
 * Get all WhatsApp conversations
 * Requires: Support or Super Admin role
 */
router.get(
  "/conversations",
  verifyToken,
  requireRole([ROLES.SUPPORT, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { status, limit = 50, startAfter, search } = req.query;

      let query = db.collection("whatsappConversations");

      // Filter by status if provided
      if (status && status !== "all") {
        query = query.where("status", "==", status);
      }

      // Order by last message time (most recent first)
      query = query.orderBy("lastMessageAt", "desc");

      // Pagination
      if (startAfter) {
        const startDoc = await db
          .collection("whatsappConversations")
          .doc(startAfter)
          .get();
        if (startDoc.exists) {
          query = query.startAfter(startDoc);
        }
      }

      query = query.limit(parseInt(limit, 10));

      const snapshot = await query.get();
      let conversations = [];

      snapshot.forEach((doc) => {
        const data = doc.data();
        conversations.push({
          id: doc.id,
          phoneNumber: data.phoneNumber,
          waId: data.waId,
          displayName: data.displayName || data.phoneNumber,
          status: data.status || "active",
          conversationState: data.conversationState || "idle",
          unreadCount: data.unreadCount || 0,
          lastMessage: data.lastMessage,
          lastMessageAt: data.lastMessageAt?.toDate?.() || data.lastMessageAt,
          linkedUserId: data.linkedUserId,
          linkedUserEmail: data.linkedUserEmail,
          documentsSubmitted: data.documentsSubmitted || 0,
          assignedTo: data.assignedTo,
          assignedToName: data.assignedToName,
          tags: data.tags || [],
          createdAt: data.createdAt?.toDate?.() || data.createdAt,
        });
      });

      // Search filter (client-side for now)
      if (search) {
        const searchLower = search.toLowerCase();
        conversations = conversations.filter(
          (conv) =>
            conv.phoneNumber?.toLowerCase().includes(searchLower) ||
            conv.displayName?.toLowerCase().includes(searchLower) ||
            conv.linkedUserEmail?.toLowerCase().includes(searchLower)
        );
      }

      res.json({
        success: true,
        conversations,
        count: conversations.length,
      });
    } catch (error) {
      console.error("❌ Error fetching conversations:", error);
      res.status(500).json({
        error: "Failed to fetch conversations",
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/support/conversations/stats
 * Get conversation statistics
 * Requires: Support or Super Admin role
 */
router.get(
  "/conversations/stats",
  verifyToken,
  requireRole([ROLES.SUPPORT, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const conversationsRef = db.collection("whatsappConversations");

      const stats = await cache.getOrSet(keys.supportStats(), TTL.STATS, async () => {
        // Get counts by status
        const [activeSnapshot, pendingSnapshot, resolvedSnapshot, totalSnapshot] =
          await Promise.all([
            conversationsRef.where("status", "==", "active").count().get(),
            conversationsRef.where("status", "==", "pending").count().get(),
            conversationsRef.where("status", "==", "resolved").count().get(),
            conversationsRef.count().get(),
          ]);

        // Get unread count
        const unreadSnapshot = await conversationsRef
          .where("unreadCount", ">", 0)
          .count()
          .get();

        // Get today's conversations
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todaySnapshot = await conversationsRef
          .where("createdAt", ">=", admin.firestore.Timestamp.fromDate(today))
          .count()
          .get();

        return {
          total: totalSnapshot.data().count,
          active: activeSnapshot.data().count,
          pending: pendingSnapshot.data().count,
          resolved: resolvedSnapshot.data().count,
          withUnread: unreadSnapshot.data().count,
          newToday: todaySnapshot.data().count,
        };
      });

      res.json({
        success: true,
        stats,
      });
    } catch (error) {
      console.error("❌ Error fetching conversation stats:", error);
      res.status(500).json({
        error: "Failed to fetch conversation stats",
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/support/conversations/:conversationId
 * Get a specific conversation with messages
 * Requires: Support or Super Admin role
 */
router.get(
  "/conversations/:conversationId",
  verifyToken,
  requireRole([ROLES.SUPPORT, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { conversationId } = req.params;
      const { messageLimit = 50 } = req.query;

      // Get conversation
      const convDoc = await db
        .collection("whatsappConversations")
        .doc(conversationId)
        .get();

      if (!convDoc.exists) {
        return res.status(404).json({
          error: "Conversation not found",
        });
      }

      const convData = convDoc.data();

      // Get messages
      const messagesSnapshot = await db
        .collection("whatsappConversations")
        .doc(conversationId)
        .collection("messages")
        .orderBy("timestamp", "desc")
        .limit(parseInt(messageLimit, 10))
        .get();

      const messages = [];
      messagesSnapshot.forEach((doc) => {
        const data = doc.data();
        messages.push({
          id: doc.id,
          type: data.type, // 'incoming' | 'outgoing'
          content: data.content,
          contentType: data.contentType || "text", // 'text' | 'image' | 'document'
          mediaUrl: data.mediaUrl,
          timestamp: data.timestamp?.toDate?.() || data.timestamp,
          status: data.status, // 'sent' | 'delivered' | 'read' | 'failed'
          sentBy: data.sentBy,
          sentByName: data.sentByName,
        });
      });

      // Mark conversation as read
      await db.collection("whatsappConversations").doc(conversationId).update({
        unreadCount: 0,
        lastReadAt: admin.firestore.FieldValue.serverTimestamp(),
        lastReadBy: req.user.uid,
      });

      res.json({
        success: true,
        conversation: {
          id: convDoc.id,
          phoneNumber: convData.phoneNumber,
          waId: convData.waId,
          displayName: convData.displayName || convData.phoneNumber,
          status: convData.status || "active",
          conversationState: convData.conversationState || "idle",
          linkedUserId: convData.linkedUserId,
          linkedUserEmail: convData.linkedUserEmail,
          documentsSubmitted: convData.documentsSubmitted || 0,
          assignedTo: convData.assignedTo,
          assignedToName: convData.assignedToName,
          tags: convData.tags || [],
          notes: convData.notes,
          createdAt: convData.createdAt?.toDate?.() || convData.createdAt,
        },
        messages: messages.reverse(), // Oldest first for display
      });
    } catch (error) {
      console.error("❌ Error fetching conversation:", error);
      res.status(500).json({
        error: "Failed to fetch conversation",
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/support/conversations/:conversationId/messages
 * Send a message to a WhatsApp conversation
 * Requires: Support or Super Admin role
 */
router.post(
  "/conversations/:conversationId/messages",
  verifyToken,
  requireRole([ROLES.SUPPORT, ROLES.SUPER_ADMIN]),
  requirePermission(PERMISSIONS.REPLY_WHATSAPP),
  async (req, res) => {
    try {
      const { conversationId } = req.params;
      const { content, contentType = "text" } = req.body;

      if (!content) {
        return res.status(400).json({
          error: "Message content is required",
        });
      }

      // Get conversation
      const convDoc = await db
        .collection("whatsappConversations")
        .doc(conversationId)
        .get();

      if (!convDoc.exists) {
        return res.status(404).json({
          error: "Conversation not found",
        });
      }

      const convData = convDoc.data();

      // Create message document
      const messageData = {
        type: "outgoing",
        content,
        contentType,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        status: "pending",
        sentBy: req.user.uid,
        sentByName: req.user.displayName || req.user.email,
      };

      const messageRef = await db
        .collection("whatsappConversations")
        .doc(conversationId)
        .collection("messages")
        .add(messageData);

      // Update conversation
      await db
        .collection("whatsappConversations")
        .doc(conversationId)
        .update({
          lastMessage: content.substring(0, 100),
          lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
          status: "active",
        });

      // TODO: Integrate with Twilio/WhatsApp API to actually send the message
      // For now, we just store it in Firestore
      // await twilioService.sendWhatsAppMessage(convData.phoneNumber, content);

      // Update message status to sent (simulated)
      await messageRef.update({
        status: "sent",
      });

      console.log(
        `📤 Message sent to ${convData.phoneNumber} by ${req.user.email}`
      );

      res.json({
        success: true,
        message: {
          id: messageRef.id,
          ...messageData,
          status: "sent",
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error("❌ Error sending message:", error);
      res.status(500).json({
        error: "Failed to send message",
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/support/conversations/:conversationId/assign
 * Assign conversation to a support agent
 * Requires: Support or Super Admin role
 */
router.post(
  "/conversations/:conversationId/assign",
  verifyToken,
  requireRole([ROLES.SUPPORT, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { conversationId } = req.params;
      const { agentId } = req.body;

      // Self-assign if no agentId provided
      const targetAgentId = agentId || req.user.uid;
      const targetAgentName =
        agentId && agentId !== req.user.uid
          ? (await db.collection("users").doc(agentId).get()).data()
              ?.displayName
          : req.user.displayName || req.user.email;

      await db.collection("whatsappConversations").doc(conversationId).update({
        assignedTo: targetAgentId,
        assignedToName: targetAgentName,
        assignedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(
        `📋 Conversation ${conversationId} assigned to ${targetAgentName}`
      );

      res.json({
        success: true,
        message: "Conversation assigned successfully",
        assignedTo: targetAgentId,
        assignedToName: targetAgentName,
      });
    } catch (error) {
      console.error("❌ Error assigning conversation:", error);
      res.status(500).json({
        error: "Failed to assign conversation",
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/support/conversations/:conversationId/status
 * Update conversation status
 * Requires: Support or Super Admin role
 */
router.post(
  "/conversations/:conversationId/status",
  verifyToken,
  requireRole([ROLES.SUPPORT, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { conversationId } = req.params;
      const { status, note } = req.body;

      const validStatuses = ["active", "pending", "resolved", "archived"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          error: "Invalid status",
          validStatuses,
        });
      }

      const updateData = {
        status,
        statusUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        statusUpdatedBy: req.user.uid,
      };

      if (status === "resolved") {
        updateData.resolvedAt = admin.firestore.FieldValue.serverTimestamp();
        updateData.resolvedBy = req.user.uid;
        updateData.resolvedByName = req.user.displayName || req.user.email;
        if (note) {
          updateData.resolutionNote = note;
        }
      }

      await db
        .collection("whatsappConversations")
        .doc(conversationId)
        .update(updateData);

      console.log(
        `📝 Conversation ${conversationId} status updated to ${status}`
      );

      res.json({
        success: true,
        message: "Conversation status updated",
        status,
      });
    } catch (error) {
      console.error("❌ Error updating conversation status:", error);
      res.status(500).json({
        error: "Failed to update conversation status",
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/support/conversations/:conversationId/notes
 * Add notes to a conversation
 * Requires: Support or Super Admin role
 */
router.post(
  "/conversations/:conversationId/notes",
  verifyToken,
  requireRole([ROLES.SUPPORT, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { conversationId } = req.params;
      const { note } = req.body;

      if (!note) {
        return res.status(400).json({
          error: "Note content is required",
        });
      }

      // Add note to notes array
      await db
        .collection("whatsappConversations")
        .doc(conversationId)
        .update({
          notes: admin.firestore.FieldValue.arrayUnion({
            content: note,
            createdAt: new Date().toISOString(),
            createdBy: req.user.uid,
            createdByName: req.user.displayName || req.user.email,
          }),
        });

      res.json({
        success: true,
        message: "Note added successfully",
      });
    } catch (error) {
      console.error("❌ Error adding note:", error);
      res.status(500).json({
        error: "Failed to add note",
        message: error.message,
      });
    }
  }
);

// ============================================
// USER LOOKUP ROUTES
// ============================================

/**
 * GET /api/support/users/search
 * Search users for support
 * Requires: Support or Super Admin role
 */
router.get(
  "/users/search",
  verifyToken,
  requireRole([ROLES.SUPPORT, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { query, limit = 20 } = req.query;

      if (!query || query.length < 2) {
        return res.status(400).json({
          error: "Search query must be at least 2 characters",
        });
      }

      // Search by email (prefix match)
      const emailSnapshot = await db
        .collection("users")
        .where("email", ">=", query)
        .where("email", "<=", query + "\uf8ff")
        .limit(parseInt(limit, 10))
        .get();

      const users = [];
      emailSnapshot.forEach((doc) => {
        const data = doc.data();
        users.push({
          uid: doc.id,
          email: data.email,
          displayName: data.displayName,
          phoneNumber: data.phoneNumber,
          role: data.role,
          isActive: data.isActive,
          createdAt: data.createdAt?.toDate?.() || data.createdAt,
        });
      });

      res.json({
        success: true,
        users,
        count: users.length,
      });
    } catch (error) {
      console.error("❌ Error searching users:", error);
      res.status(500).json({
        error: "Failed to search users",
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/support/users/:userId/documents
 * Get documents for a specific user
 * Requires: Support or Super Admin role
 */
router.get(
  "/users/:userId/documents",
  verifyToken,
  requireRole([ROLES.SUPPORT, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { limit = 20, status } = req.query;

      let query = db.collection("documents").where("userId", "==", userId);

      if (status) {
        query = query.where("status", "==", status);
      }

      query = query.orderBy("createdAt", "desc").limit(parseInt(limit, 10));

      const snapshot = await query.get();
      const documents = [];

      snapshot.forEach((doc) => {
        const data = doc.data();
        documents.push({
          id: doc.id,
          formType: data.formType,
          status: data.status,
          studentName: data.studentName || data.extractedData?.studentName,
          schoolName: data.schoolName || data.extractedData?.schoolName,
          createdAt: data.createdAt?.toDate?.() || data.createdAt,
          approvedAt: data.approvedAt?.toDate?.() || data.approvedAt,
        });
      });

      res.json({
        success: true,
        documents,
        count: documents.length,
      });
    } catch (error) {
      console.error("❌ Error fetching user documents:", error);
      res.status(500).json({
        error: "Failed to fetch user documents",
        message: error.message,
      });
    }
  }
);

// ============================================
// DOCUMENT DELIVERY ROUTES
// ============================================

/**
 * POST /api/support/send-document
 * Send a translated document via WhatsApp
 * Requires: Support or Super Admin role
 */
router.post(
  "/send-document",
  verifyToken,
  requireRole([ROLES.SUPPORT, ROLES.SUPER_ADMIN]),
  requirePermission(PERMISSIONS.SEND_WHATSAPP_TRANSLATION),
  async (req, res) => {
    try {
      const { conversationId, documentId, message } = req.body;

      if (!conversationId || !documentId) {
        return res.status(400).json({
          error: "Conversation ID and Document ID are required",
        });
      }

      // Get document
      const docSnapshot = await db
        .collection("documents")
        .doc(documentId)
        .get();

      if (!docSnapshot.exists) {
        return res.status(404).json({
          error: "Document not found",
        });
      }

      const docData = docSnapshot.data();

      if (docData.status !== "approved") {
        return res.status(400).json({
          error: "Document must be approved before sending",
          currentStatus: docData.status,
        });
      }

      // Get conversation
      const convDoc = await db
        .collection("whatsappConversations")
        .doc(conversationId)
        .get();

      if (!convDoc.exists) {
        return res.status(404).json({
          error: "Conversation not found",
        });
      }

      const convData = convDoc.data();

      // Create delivery record
      const deliveryData = {
        type: "outgoing",
        content: message || `📄 Your translated document is ready!`,
        contentType: "document",
        documentId,
        documentType: docData.formType,
        mediaUrl: docData.pdfUrl,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        status: "pending",
        sentBy: req.user.uid,
        sentByName: req.user.displayName || req.user.email,
      };

      const messageRef = await db
        .collection("whatsappConversations")
        .doc(conversationId)
        .collection("messages")
        .add(deliveryData);

      // Update document with delivery info
      await db.collection("documents").doc(documentId).update({
        whatsappDelivered: true,
        whatsappDeliveredAt: admin.firestore.FieldValue.serverTimestamp(),
        whatsappDeliveredTo: convData.phoneNumber,
        whatsappDeliveredBy: req.user.uid,
      });

      // TODO: Integrate with Twilio/WhatsApp API to send the PDF
      // await twilioService.sendWhatsAppDocument(convData.phoneNumber, docData.pdfUrl);

      // Update message status (simulated)
      await messageRef.update({
        status: "sent",
      });

      console.log(
        `📤 Document ${documentId} sent to ${convData.phoneNumber} by ${req.user.email}`
      );

      res.json({
        success: true,
        message: "Document sent successfully",
        deliveryId: messageRef.id,
      });
    } catch (error) {
      console.error("❌ Error sending document:", error);
      res.status(500).json({
        error: "Failed to send document",
        message: error.message,
      });
    }
  }
);

// ============================================
// SUPPORT AGENT STATS ROUTES
// ============================================

/**
 * GET /api/support/stats
 * Get support agent statistics
 * Requires: Support or Super Admin role
 */
router.get(
  "/stats",
  verifyToken,
  requireRole([ROLES.SUPPORT, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { period = "month" } = req.query;

      const agentStatsCacheKey = `${keys.agentStats(req.user.uid)}:${period}`;
      const stats = await cache.getOrSet(agentStatsCacheKey, TTL.STATS, async () => {
        // Calculate date range
        const now = new Date();
        let startDate;

        switch (period) {
          case "day":
            startDate = new Date(now.setHours(0, 0, 0, 0));
            break;
          case "week":
            startDate = new Date(now.setDate(now.getDate() - 7));
            break;
          case "month":
            startDate = new Date(now.setMonth(now.getMonth() - 1));
            break;
          case "year":
            startDate = new Date(now.setFullYear(now.getFullYear() - 1));
            break;
          default:
            startDate = new Date(0); // All time
        }

        const startTimestamp = admin.firestore.Timestamp.fromDate(startDate);

        // Get agent's resolved conversations
        const resolvedSnapshot = await db
          .collection("whatsappConversations")
          .where("resolvedBy", "==", req.user.uid)
          .where("resolvedAt", ">=", startTimestamp)
          .count()
          .get();

        // Get agent profile stats from users collection
        const userDoc = await db.collection("users").doc(req.user.uid).get();
        const userData = userDoc.data();

        return {
          period,
          conversationsResolved: resolvedSnapshot.data().count,
          messagesSent: userData?.supportStats?.messagesSent || 0,
          documentsDelivered: userData?.supportStats?.documentsDelivered || 0,
          avgResponseTimeMinutes:
            userData?.supportStats?.avgResponseTimeMinutes || 0,
          allTimeStats: {
            conversationsResolved:
              userData?.supportStats?.totalConversationsResolved || 0,
            documentsDelivered:
              userData?.supportStats?.totalDocumentsDelivered || 0,
          },
        };
      });

      res.json({
        success: true,
        stats,
      });
    } catch (error) {
      console.error("❌ Error fetching support stats:", error);
      res.status(500).json({
        error: "Failed to fetch support stats",
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/support/stats/team
 * Get team statistics (for super admin)
 * Requires: Super Admin role
 */
router.get(
  "/stats/team",
  verifyToken,
  requireRole([ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const teamStats = await cache.getOrSet(keys.supportTeam(), TTL.STATS, async () => {
        // Get all support agents
        const agentsSnapshot = await db
          .collection("users")
          .where("role", "==", ROLES.SUPPORT)
          .where("isActive", "==", true)
          .get();

        const agents = [];
        agentsSnapshot.forEach((doc) => {
          const data = doc.data();
          agents.push({
            uid: doc.id,
            displayName: data.displayName || data.email,
            email: data.email,
            stats: data.supportStats || {},
          });
        });

        // Get overall stats
        const [totalConvs, resolvedConvs, pendingConvs] = await Promise.all([
          db.collection("whatsappConversations").count().get(),
          db
            .collection("whatsappConversations")
            .where("status", "==", "resolved")
            .count()
            .get(),
          db
            .collection("whatsappConversations")
            .where("status", "==", "pending")
            .count()
            .get(),
        ]);

        return {
          teamStats: {
            totalAgents: agents.length,
            totalConversations: totalConvs.data().count,
            resolvedConversations: resolvedConvs.data().count,
            pendingConversations: pendingConvs.data().count,
          },
          agents,
        };
      });

      res.json({
        success: true,
        ...teamStats,
      });
    } catch (error) {
      console.error("❌ Error fetching team stats:", error);
      res.status(500).json({
        error: "Failed to fetch team stats",
        message: error.message,
      });
    }
  }
);

// ============================================
// QUICK REPLIES / TEMPLATES ROUTES
// ============================================

/**
 * GET /api/support/templates
 * Get message templates for quick replies
 * Requires: Support or Super Admin role
 */
router.get(
  "/templates",
  verifyToken,
  requireRole([ROLES.SUPPORT, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const templates = await cache.getOrSet(keys.messageTemplates(), TTL.TEMPLATE, async () => {
        const templatesSnapshot = await db
          .collection("messageTemplates")
          .where("isActive", "==", true)
          .orderBy("category")
          .orderBy("name")
          .get();

        const result = [];
        templatesSnapshot.forEach((doc) => {
          const data = doc.data();
          result.push({
            id: doc.id,
            name: data.name,
            category: data.category,
            content: data.content,
            variables: data.variables || [],
          });
        });
        return result;
      });

      res.json({
        success: true,
        templates,
      });
    } catch (error) {
      console.error("❌ Error fetching templates:", error);
      res.status(500).json({
        error: "Failed to fetch templates",
        message: error.message,
      });
    }
  }
);

// ============================================
// SUPPORT TICKETS ROUTES
// ============================================

const {
  onTicketCreated,
  onTicketResolved,
} = require("../services/notificationService");

const TICKET_CATEGORIES = [
  "document_issue",
  "account_issue",
  "payment_issue",
  "translation_quality",
  "technical_issue",
  "general_inquiry",
  "other",
];

const TICKET_PRIORITIES = ["low", "medium", "high", "urgent"];

/**
 * POST /api/support/tickets
 * Create a support ticket (any authenticated user)
 */
router.post(
  "/tickets",
  verifyToken,
  async (req, res) => {
    try {
      const { subject, message, category, priority, documentId } = req.body;

      if (!subject || !message) {
        return res.status(400).json({
          error: "Subject and message are required",
        });
      }

      if (subject.length > 200) {
        return res.status(400).json({
          error: "Subject must be 200 characters or less",
        });
      }

      if (message.length > 5000) {
        return res.status(400).json({
          error: "Message must be 5000 characters or less",
        });
      }

      const ticketCategory = TICKET_CATEGORIES.includes(category)
        ? category
        : "general_inquiry";
      const ticketPriority = TICKET_PRIORITIES.includes(priority)
        ? priority
        : "medium";

      const ticketRef = db.collection("supportTickets").doc();
      const ticketData = {
        id: ticketRef.id,
        userId: req.user.uid,
        userEmail: req.user.email,
        userName: req.user.displayName || req.user.email,
        subject,
        category: ticketCategory,
        priority: ticketPriority,
        status: "open",
        documentId: documentId || null,
        assignedTo: null,
        assignedToName: null,
        rating: null,
        ratingComment: null,
        ratedAt: null,
        messageCount: 1,
        lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
        lastMessageBy: "user",
        resolvedAt: null,
        resolvedBy: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await ticketRef.set(ticketData);

      // Add the initial message
      await ticketRef.collection("messages").add({
        content: message,
        senderId: req.user.uid,
        senderName: req.user.displayName || req.user.email,
        senderRole: "user",
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Trigger notifications (fire-and-forget)
      onTicketCreated({
        id: ticketRef.id,
        userId: req.user.uid,
        userEmail: req.user.email,
        userName: req.user.displayName || req.user.email,
        subject,
        category: ticketCategory,
        priority: ticketPriority,
      }).catch((err) => console.error("🚨 Ticket notification failed:", err.message));

      console.log(`🎫 Ticket ${ticketRef.id} created by ${req.user.email}`);

      res.status(201).json({
        success: true,
        ticket: {
          ...ticketData,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastMessageAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error("❌ Error creating ticket:", error);
      res.status(500).json({
        error: "Failed to create ticket",
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/support/tickets
 * List tickets - agents see all, users see their own
 */
router.get(
  "/tickets",
  verifyToken,
  async (req, res) => {
    try {
      const { status, category, priority, limit = 50, startAfter } = req.query;
      const userRole = req.user.role || "user";
      const isAgent = ["support", "superadmin"].includes(userRole);

      let query = db.collection("supportTickets");

      // Users only see their own tickets
      if (!isAgent) {
        query = query.where("userId", "==", req.user.uid);
      }

      // Filter by status
      if (status && status !== "all") {
        query = query.where("status", "==", status);
      }

      // Order by most recent
      query = query.orderBy("updatedAt", "desc");

      // Pagination
      if (startAfter) {
        const startDoc = await db.collection("supportTickets").doc(startAfter).get();
        if (startDoc.exists) {
          query = query.startAfter(startDoc);
        }
      }

      query = query.limit(parseInt(limit, 10));

      const snapshot = await query.get();
      const tickets = [];

      snapshot.forEach((doc) => {
        const data = doc.data();
        tickets.push({
          id: doc.id,
          userId: data.userId,
          userEmail: data.userEmail,
          userName: data.userName,
          subject: data.subject,
          category: data.category,
          priority: data.priority,
          status: data.status,
          assignedTo: data.assignedTo,
          assignedToName: data.assignedToName,
          messageCount: data.messageCount || 1,
          lastMessageAt: data.lastMessageAt?.toDate?.() || data.lastMessageAt,
          lastMessageBy: data.lastMessageBy,
          rating: data.rating,
          createdAt: data.createdAt?.toDate?.() || data.createdAt,
          updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
          resolvedAt: data.resolvedAt?.toDate?.() || data.resolvedAt,
        });
      });

      // Get stats for agents
      let ticketStats = null;
      if (isAgent) {
        const ticketsRef = db.collection("supportTickets");
        const [openCount, inProgressCount, resolvedCount, totalCount] =
          await Promise.all([
            ticketsRef.where("status", "==", "open").count().get(),
            ticketsRef.where("status", "==", "in_progress").count().get(),
            ticketsRef.where("status", "==", "resolved").count().get(),
            ticketsRef.count().get(),
          ]);

        ticketStats = {
          open: openCount.data().count,
          inProgress: inProgressCount.data().count,
          resolved: resolvedCount.data().count,
          total: totalCount.data().count,
        };
      }

      res.json({
        success: true,
        tickets,
        stats: ticketStats,
        count: tickets.length,
      });
    } catch (error) {
      console.error("❌ Error fetching tickets:", error);
      res.status(500).json({
        error: "Failed to fetch tickets",
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/support/tickets/:ticketId
 * Get ticket with messages
 */
router.get(
  "/tickets/:ticketId",
  verifyToken,
  async (req, res) => {
    try {
      const { ticketId } = req.params;
      const userRole = req.user.role || "user";
      const isAgent = ["support", "superadmin"].includes(userRole);

      const ticketDoc = await db.collection("supportTickets").doc(ticketId).get();

      if (!ticketDoc.exists) {
        return res.status(404).json({ error: "Ticket not found" });
      }

      const ticketData = ticketDoc.data();

      // Users can only view their own tickets
      if (!isAgent && ticketData.userId !== req.user.uid) {
        return res.status(403).json({ error: "You can only view your own tickets" });
      }

      // Get messages
      const messagesSnapshot = await db
        .collection("supportTickets")
        .doc(ticketId)
        .collection("messages")
        .orderBy("timestamp", "asc")
        .get();

      const messages = [];
      messagesSnapshot.forEach((doc) => {
        const data = doc.data();
        messages.push({
          id: doc.id,
          content: data.content,
          senderId: data.senderId,
          senderName: data.senderName,
          senderRole: data.senderRole,
          timestamp: data.timestamp?.toDate?.() || data.timestamp,
        });
      });

      res.json({
        success: true,
        ticket: {
          id: ticketDoc.id,
          userId: ticketData.userId,
          userEmail: ticketData.userEmail,
          userName: ticketData.userName,
          subject: ticketData.subject,
          category: ticketData.category,
          priority: ticketData.priority,
          status: ticketData.status,
          documentId: ticketData.documentId,
          assignedTo: ticketData.assignedTo,
          assignedToName: ticketData.assignedToName,
          rating: ticketData.rating,
          ratingComment: ticketData.ratingComment,
          ratedAt: ticketData.ratedAt?.toDate?.() || ticketData.ratedAt,
          messageCount: ticketData.messageCount || 1,
          lastMessageAt: ticketData.lastMessageAt?.toDate?.() || ticketData.lastMessageAt,
          resolvedAt: ticketData.resolvedAt?.toDate?.() || ticketData.resolvedAt,
          resolvedBy: ticketData.resolvedBy,
          createdAt: ticketData.createdAt?.toDate?.() || ticketData.createdAt,
          updatedAt: ticketData.updatedAt?.toDate?.() || ticketData.updatedAt,
        },
        messages,
      });
    } catch (error) {
      console.error("❌ Error fetching ticket:", error);
      res.status(500).json({
        error: "Failed to fetch ticket",
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/support/tickets/:ticketId/reply
 * Reply to a ticket (user or agent)
 */
router.post(
  "/tickets/:ticketId/reply",
  verifyToken,
  async (req, res) => {
    try {
      const { ticketId } = req.params;
      const { content } = req.body;

      if (!content || content.length > 5000) {
        return res.status(400).json({
          error: "Message content is required and must be 5000 characters or less",
        });
      }

      const ticketDoc = await db.collection("supportTickets").doc(ticketId).get();

      if (!ticketDoc.exists) {
        return res.status(404).json({ error: "Ticket not found" });
      }

      const ticketData = ticketDoc.data();
      const userRole = req.user.role || "user";
      const isAgent = ["support", "superadmin"].includes(userRole);

      // Users can only reply to their own tickets
      if (!isAgent && ticketData.userId !== req.user.uid) {
        return res.status(403).json({ error: "You can only reply to your own tickets" });
      }

      // Cannot reply to closed tickets
      if (ticketData.status === "closed") {
        return res.status(400).json({ error: "Cannot reply to a closed ticket" });
      }

      const senderRole = isAgent ? "agent" : "user";

      // Add message
      const messageRef = await db
        .collection("supportTickets")
        .doc(ticketId)
        .collection("messages")
        .add({
          content,
          senderId: req.user.uid,
          senderName: req.user.displayName || req.user.email,
          senderRole,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });

      // Update ticket
      const updateData = {
        messageCount: admin.firestore.FieldValue.increment(1),
        lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
        lastMessageBy: senderRole,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      // If agent replies to an open ticket, auto-set to in_progress
      if (isAgent && ticketData.status === "open") {
        updateData.status = "in_progress";
        if (!ticketData.assignedTo) {
          updateData.assignedTo = req.user.uid;
          updateData.assignedToName = req.user.displayName || req.user.email;
        }
      }

      await db.collection("supportTickets").doc(ticketId).update(updateData);

      res.json({
        success: true,
        message: {
          id: messageRef.id,
          content,
          senderId: req.user.uid,
          senderName: req.user.displayName || req.user.email,
          senderRole,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error("❌ Error replying to ticket:", error);
      res.status(500).json({
        error: "Failed to reply to ticket",
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/support/tickets/:ticketId/status
 * Update ticket status (agents only)
 */
router.post(
  "/tickets/:ticketId/status",
  verifyToken,
  requireRole([ROLES.SUPPORT, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { ticketId } = req.params;
      const { status, note } = req.body;

      const validStatuses = ["open", "in_progress", "resolved", "closed"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          error: "Invalid status",
          validStatuses,
        });
      }

      const ticketDoc = await db.collection("supportTickets").doc(ticketId).get();
      if (!ticketDoc.exists) {
        return res.status(404).json({ error: "Ticket not found" });
      }

      const updateData = {
        status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (status === "resolved") {
        updateData.resolvedAt = admin.firestore.FieldValue.serverTimestamp();
        updateData.resolvedBy = req.user.uid;
      }

      await db.collection("supportTickets").doc(ticketId).update(updateData);

      // Add system message
      if (note) {
        await db.collection("supportTickets").doc(ticketId).collection("messages").add({
          content: note,
          senderId: req.user.uid,
          senderName: req.user.displayName || req.user.email,
          senderRole: "system",
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // Notify user when ticket is resolved
      if (status === "resolved") {
        const ticketData = ticketDoc.data();
        onTicketResolved({
          id: ticketId,
          userId: ticketData.userId,
          subject: ticketData.subject,
        }).catch((err) => console.error("🚨 Ticket resolved notification failed:", err.message));
      }

      console.log(`📝 Ticket ${ticketId} status updated to ${status}`);

      res.json({ success: true, status });
    } catch (error) {
      console.error("❌ Error updating ticket status:", error);
      res.status(500).json({
        error: "Failed to update ticket status",
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/support/tickets/:ticketId/assign
 * Assign ticket to an agent
 */
router.post(
  "/tickets/:ticketId/assign",
  verifyToken,
  requireRole([ROLES.SUPPORT, ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { ticketId } = req.params;
      const { agentId } = req.body;

      const targetAgentId = agentId || req.user.uid;
      const targetAgentName =
        agentId && agentId !== req.user.uid
          ? (await db.collection("users").doc(agentId).get()).data()?.displayName
          : req.user.displayName || req.user.email;

      await db.collection("supportTickets").doc(ticketId).update({
        assignedTo: targetAgentId,
        assignedToName: targetAgentName,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      res.json({
        success: true,
        assignedTo: targetAgentId,
        assignedToName: targetAgentName,
      });
    } catch (error) {
      console.error("❌ Error assigning ticket:", error);
      res.status(500).json({
        error: "Failed to assign ticket",
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/support/tickets/:ticketId/rate
 * Rate the support experience (user only, ticket must be resolved)
 */
router.post(
  "/tickets/:ticketId/rate",
  verifyToken,
  async (req, res) => {
    try {
      const { ticketId } = req.params;
      const { rating, comment } = req.body;

      if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({
          error: "Rating must be between 1 and 5",
        });
      }

      const ticketDoc = await db.collection("supportTickets").doc(ticketId).get();
      if (!ticketDoc.exists) {
        return res.status(404).json({ error: "Ticket not found" });
      }

      const ticketData = ticketDoc.data();

      // Only the ticket creator can rate
      if (ticketData.userId !== req.user.uid) {
        return res.status(403).json({ error: "Only the ticket creator can rate" });
      }

      // Can only rate resolved tickets
      if (ticketData.status !== "resolved") {
        return res.status(400).json({ error: "Can only rate resolved tickets" });
      }

      // Check if already rated
      if (ticketData.rating) {
        return res.status(400).json({ error: "Ticket has already been rated" });
      }

      const safeComment = comment ? String(comment).substring(0, 1000) : null;

      await db.collection("supportTickets").doc(ticketId).update({
        rating: parseInt(rating, 10),
        ratingComment: safeComment,
        ratedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Update the assigned agent's rating stats if there is one
      if (ticketData.assignedTo) {
        await db.collection("users").doc(ticketData.assignedTo).update({
          "supportStats.totalRatings": admin.firestore.FieldValue.increment(1),
          "supportStats.totalRatingScore": admin.firestore.FieldValue.increment(parseInt(rating, 10)),
        }).catch((err) => console.error("🚨 Agent rating stats update failed:", err.message));
      }

      console.log(`⭐ Ticket ${ticketId} rated ${rating}/5`);

      res.json({
        success: true,
        message: "Thank you for your feedback!",
      });
    } catch (error) {
      console.error("❌ Error rating ticket:", error);
      res.status(500).json({
        error: "Failed to rate ticket",
        message: error.message,
      });
    }
  }
);

module.exports = router;

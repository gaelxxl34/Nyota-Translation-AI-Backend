// Role-Based Access Control (RBAC) Middleware for NTC
// Handles permission checking based on user roles

/**
 * User Roles Hierarchy:
 * - superadmin: Full system access
 * - translator: Review and approve translations
 * - partner: View organization's documents
 * - support: Handle WhatsApp and user support
 * - user: Basic document upload and view own docs
 */

const ROLES = {
  SUPER_ADMIN: "superadmin",
  TRANSLATOR: "translator",
  PARTNER: "partner",
  SUPPORT: "support",
  USER: "user",
};

// Role hierarchy (higher index = more permissions)
const ROLE_HIERARCHY = {
  [ROLES.USER]: 1,
  [ROLES.SUPPORT]: 2,
  [ROLES.PARTNER]: 2,
  [ROLES.TRANSLATOR]: 3,
  [ROLES.SUPER_ADMIN]: 4,
};

// Permission definitions
const PERMISSIONS = {
  // Document permissions
  UPLOAD_DOCUMENT: "upload:document",
  VIEW_OWN_DOCUMENTS: "view:own_documents",
  VIEW_ALL_DOCUMENTS: "view:all_documents",
  VIEW_PARTNER_DOCUMENTS: "view:partner_documents",
  EDIT_DOCUMENT: "edit:document",
  APPROVE_DOCUMENT: "approve:document",
  DELETE_DOCUMENT: "delete:document",

  // User management permissions
  CREATE_USER: "create:user",
  VIEW_ALL_USERS: "view:all_users",
  VIEW_PARTNER_USERS: "view:partner_users",
  EDIT_USER: "edit:user",
  DELETE_USER: "delete:user",
  ASSIGN_ROLE: "assign:role",

  // Partner management permissions
  CREATE_PARTNER: "create:partner",
  VIEW_ALL_PARTNERS: "view:all_partners",
  EDIT_PARTNER: "edit:partner",
  DELETE_PARTNER: "delete:partner",

  // Analytics permissions
  VIEW_SYSTEM_ANALYTICS: "view:system_analytics",
  VIEW_PARTNER_ANALYTICS: "view:partner_analytics",
  VIEW_TRANSLATOR_ANALYTICS: "view:translator_analytics",

  // WhatsApp permissions
  VIEW_WHATSAPP_CONVERSATIONS: "view:whatsapp_conversations",
  REPLY_WHATSAPP: "reply:whatsapp",
  SEND_WHATSAPP_TRANSLATION: "send:whatsapp_translation",

  // System permissions
  MANAGE_SETTINGS: "manage:settings",
  MANAGE_PRICING: "manage:pricing",
  VIEW_ACTIVITY_LOGS: "view:activity_logs",
};

// Role-Permission mapping
const ROLE_PERMISSIONS = {
  [ROLES.USER]: [
    PERMISSIONS.UPLOAD_DOCUMENT,
    PERMISSIONS.VIEW_OWN_DOCUMENTS,
    PERMISSIONS.EDIT_DOCUMENT, // Only own documents before submission
  ],

  [ROLES.SUPPORT]: [
    PERMISSIONS.VIEW_OWN_DOCUMENTS,
    PERMISSIONS.VIEW_ALL_DOCUMENTS,
    PERMISSIONS.VIEW_ALL_USERS,
    PERMISSIONS.VIEW_WHATSAPP_CONVERSATIONS,
    PERMISSIONS.REPLY_WHATSAPP,
    PERMISSIONS.SEND_WHATSAPP_TRANSLATION,
  ],

  [ROLES.PARTNER]: [
    PERMISSIONS.VIEW_OWN_DOCUMENTS,
    PERMISSIONS.VIEW_PARTNER_DOCUMENTS,
    PERMISSIONS.VIEW_PARTNER_USERS,
    PERMISSIONS.VIEW_PARTNER_ANALYTICS,
  ],

  [ROLES.TRANSLATOR]: [
    PERMISSIONS.VIEW_OWN_DOCUMENTS,
    PERMISSIONS.VIEW_ALL_DOCUMENTS,
    PERMISSIONS.EDIT_DOCUMENT,
    PERMISSIONS.APPROVE_DOCUMENT,
    PERMISSIONS.VIEW_TRANSLATOR_ANALYTICS,
    PERMISSIONS.SEND_WHATSAPP_TRANSLATION,
  ],

  [ROLES.SUPER_ADMIN]: [
    // Super admin has ALL permissions
    ...Object.values(PERMISSIONS),
  ],
};

/**
 * Check if a user has a specific permission
 * @param {string} role - User's role
 * @param {string} permission - Permission to check
 * @param {string[]} customPermissions - Optional custom permissions array
 * @returns {boolean}
 */
const hasPermission = (role, permission, customPermissions = []) => {
  // Check custom permissions first
  if (customPermissions.includes(permission)) {
    return true;
  }

  // Check role-based permissions
  const rolePermissions = ROLE_PERMISSIONS[role] || [];
  return rolePermissions.includes(permission);
};

/**
 * Check if a user has a minimum role level
 * @param {string} userRole - User's current role
 * @param {string} requiredRole - Minimum required role
 * @returns {boolean}
 */
const hasMinimumRole = (userRole, requiredRole) => {
  const userLevel = ROLE_HIERARCHY[userRole] || 0;
  const requiredLevel = ROLE_HIERARCHY[requiredRole] || 0;
  return userLevel >= requiredLevel;
};

/**
 * Middleware to require a specific role
 * @param {string|string[]} allowedRoles - Role(s) allowed to access the route
 * @returns {Function} Express middleware
 */
const requireRole = (allowedRoles) => {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Authentication required",
        code: "AUTH_REQUIRED",
      });
    }

    const userRole = req.user.role || ROLES.USER;

    // Super admin always has access
    if (userRole === ROLES.SUPER_ADMIN) {
      return next();
    }

    // Check if user's role is in allowed roles
    if (roles.includes(userRole)) {
      return next();
    }

    console.log(
      `🚫 Access denied for ${
        req.user.email
      } (${userRole}). Required: ${roles.join(", ")}`
    );

    return res.status(403).json({
      error: "Forbidden",
      message: "You do not have permission to access this resource",
      code: "INSUFFICIENT_ROLE",
      required: roles,
      current: userRole,
    });
  };
};

/**
 * Middleware to require a specific permission
 * @param {string|string[]} requiredPermissions - Permission(s) required
 * @param {Object} options - Options for permission check
 * @param {boolean} options.requireAll - If true, user must have ALL permissions
 * @returns {Function} Express middleware
 */
const requirePermission = (requiredPermissions, options = {}) => {
  const permissions = Array.isArray(requiredPermissions)
    ? requiredPermissions
    : [requiredPermissions];
  const { requireAll = false } = options;

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Authentication required",
        code: "AUTH_REQUIRED",
      });
    }

    const userRole = req.user.role || ROLES.USER;
    const customPermissions = req.user.permissions || [];

    // Super admin always has access
    if (userRole === ROLES.SUPER_ADMIN) {
      return next();
    }

    const checkPermission = (perm) =>
      hasPermission(userRole, perm, customPermissions);

    const hasAccess = requireAll
      ? permissions.every(checkPermission)
      : permissions.some(checkPermission);

    if (hasAccess) {
      return next();
    }

    console.log(
      `🚫 Permission denied for ${req.user.email}. Required: ${permissions.join(
        ", "
      )}`
    );

    return res.status(403).json({
      error: "Forbidden",
      message: "You do not have the required permissions",
      code: "INSUFFICIENT_PERMISSIONS",
      required: permissions,
    });
  };
};

/**
 * Middleware to check document ownership or role-based access
 * Used for routes that access specific documents
 * @param {Object} options - Options
 * @param {string[]} options.bypassRoles - Roles that can access any document
 * @returns {Function} Express middleware
 */
const requireDocumentAccess = (options = {}) => {
  const { bypassRoles = [ROLES.SUPER_ADMIN, ROLES.TRANSLATOR, ROLES.SUPPORT] } =
    options;

  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Authentication required",
        code: "AUTH_REQUIRED",
      });
    }

    const userRole = req.user.role || ROLES.USER;

    // Bypass roles can access any document
    if (bypassRoles.includes(userRole)) {
      return next();
    }

    // For partners, check if document belongs to their organization
    if (userRole === ROLES.PARTNER) {
      const documentId = req.params.id || req.params.documentId;
      if (documentId) {
        // Will be checked in the route handler with partnerId comparison
        req.checkPartnerAccess = true;
      }
      return next();
    }

    // For regular users, document ownership will be checked in route handler
    req.checkOwnership = true;
    return next();
  };
};

/**
 * Middleware to add user's role info to request
 * Should be used after verifyToken
 * @returns {Function} Express middleware
 */
const attachRoleInfo = () => {
  return (req, res, next) => {
    if (req.user) {
      // Ensure role exists, default to 'user'
      req.user.role = req.user.role || ROLES.USER;

      // Add helper methods to request
      req.hasPermission = (permission) =>
        hasPermission(req.user.role, permission, req.user.permissions || []);

      req.hasRole = (role) => req.user.role === role;

      req.hasMinimumRole = (minRole) => hasMinimumRole(req.user.role, minRole);

      req.isSuperAdmin = () => req.user.role === ROLES.SUPER_ADMIN;
    }
    next();
  };
};

module.exports = {
  ROLES,
  PERMISSIONS,
  ROLE_HIERARCHY,
  ROLE_PERMISSIONS,
  hasPermission,
  hasMinimumRole,
  requireRole,
  requirePermission,
  requireDocumentAccess,
  attachRoleInfo,
};

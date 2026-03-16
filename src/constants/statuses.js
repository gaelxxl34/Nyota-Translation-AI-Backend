// Document workflow statuses for NTC platform
// Tracks a document from upload through certification

const DOCUMENT_STATUS = {
  // Draft phase — AI has processed, user sees watermarked preview
  DRAFT: "draft",

  // User has submitted and paid — awaiting agent assignment
  PENDING_REVIEW: "pending_review",

  // Agent is actively reviewing/editing the translation
  IN_REVIEW: "in_review",

  // Agent has approved — certified PDF generated with hash + QR
  CERTIFIED: "certified",

  // Agent rejected — needs re-upload or clarification
  REJECTED: "rejected",

  // User cancelled before certification
  CANCELLED: "cancelled",
};

// Speed tiers for certified document delivery
const SPEED_TIERS = {
  STANDARD: {
    id: "standard",
    label: "Standard",
    description: "Up to 24 hours",
    maxHours: 48,
  },
  RUSH: {
    id: "rush",
    label: "Rush",
    description: "Up to 12 hours",
    maxHours: 24,
  },
  EXPRESS: {
    id: "express",
    label: "Express",
    description: "1–5 hours",
    maxHours: 5,
  },
};

// Valid status transitions (from → allowed next statuses)
const STATUS_TRANSITIONS = {
  [DOCUMENT_STATUS.DRAFT]: [DOCUMENT_STATUS.PENDING_REVIEW, DOCUMENT_STATUS.CANCELLED],
  [DOCUMENT_STATUS.PENDING_REVIEW]: [DOCUMENT_STATUS.IN_REVIEW, DOCUMENT_STATUS.CANCELLED],
  [DOCUMENT_STATUS.IN_REVIEW]: [DOCUMENT_STATUS.CERTIFIED, DOCUMENT_STATUS.REJECTED],
  [DOCUMENT_STATUS.CERTIFIED]: [], // Terminal state
  [DOCUMENT_STATUS.REJECTED]: [DOCUMENT_STATUS.PENDING_REVIEW, DOCUMENT_STATUS.CANCELLED],
  [DOCUMENT_STATUS.CANCELLED]: [], // Terminal state
};

const isValidTransition = (currentStatus, newStatus) => {
  const allowed = STATUS_TRANSITIONS[currentStatus];
  return allowed ? allowed.includes(newStatus) : false;
};

const isTerminalStatus = (status) => {
  return [DOCUMENT_STATUS.CERTIFIED, DOCUMENT_STATUS.CANCELLED].includes(status);
};

module.exports = {
  DOCUMENT_STATUS,
  SPEED_TIERS,
  STATUS_TRANSITIONS,
  isValidTransition,
  isTerminalStatus,
};

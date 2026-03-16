// Certification ID generator for NTC platform
// Format: NTC-YYYY-XXXXXX (e.g., NTC-2026-A7K9F2)

const crypto = require("crypto");

const ID_PREFIX = "NTC";
const RANDOM_LENGTH = 6;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No 0/O/1/I to avoid confusion

/**
 * Generate a certification ID: NTC-YYYY-XXXXXX
 * Uses crypto.randomBytes for unguessable IDs
 */
const generateCertificationId = () => {
  const year = new Date().getFullYear();
  const bytes = crypto.randomBytes(RANDOM_LENGTH);
  let random = "";

  for (let i = 0; i < RANDOM_LENGTH; i++) {
    random += ALPHABET[bytes[i] % ALPHABET.length];
  }

  return `${ID_PREFIX}-${year}-${random}`;
};

/**
 * Validate format of a certification ID
 */
const isValidCertificationId = (id) => {
  if (typeof id !== "string") return false;
  const pattern = new RegExp(`^${ID_PREFIX}-\\d{4}-[${ALPHABET}]{${RANDOM_LENGTH}}$`);
  return pattern.test(id);
};

/**
 * Generate SHA-256 hash of a PDF buffer for tamper detection
 */
const generateDocumentHash = (pdfBuffer) => {
  return crypto.createHash("sha256").update(pdfBuffer).digest("hex");
};

/**
 * Verify a PDF buffer matches its expected hash
 */
const verifyDocumentHash = (pdfBuffer, expectedHash) => {
  const actualHash = generateDocumentHash(pdfBuffer);
  return actualHash === expectedHash;
};

module.exports = {
  generateCertificationId,
  isValidCertificationId,
  generateDocumentHash,
  verifyDocumentHash,
};

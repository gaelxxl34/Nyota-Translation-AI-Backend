// Firebase Storage Service for NTC
// Handles file uploads to Firebase Cloud Storage

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

// Storage bucket name (from Firebase console)
const STORAGE_BUCKET = "ntc-app-7ac7e.firebasestorage.app";

/**
 * Get Firebase Storage bucket instance
 * @returns {admin.storage.Bucket} Firebase Storage bucket
 */
const getBucket = () => {
  try {
    return admin.storage().bucket(STORAGE_BUCKET);
  } catch (error) {
    console.error("🚨 Failed to get storage bucket:", error.message);
    throw new Error("Firebase Storage not initialized");
  }
};

/**
 * Upload a file to Firebase Storage
 * @param {string} localFilePath - Path to the local file
 * @param {string} destinationPath - Path in Firebase Storage (e.g., 'documents/user123/file.jpg')
 * @param {Object} metadata - Optional metadata for the file
 * @returns {Promise<{success: boolean, url?: string, storagePath?: string, error?: string}>}
 */
const uploadToStorage = async (
  localFilePath,
  destinationPath,
  metadata = {}
) => {
  try {
    console.log(`📤 Uploading to Firebase Storage: ${destinationPath}`);

    const bucket = getBucket();
    const file = bucket.file(destinationPath);

    // Upload the file
    await bucket.upload(localFilePath, {
      destination: destinationPath,
      metadata: {
        contentType: metadata.contentType || "application/octet-stream",
        metadata: {
          originalName: metadata.originalName || path.basename(localFilePath),
          uploadedBy: metadata.userId || "unknown",
          uploadedAt: new Date().toISOString(),
          formType: metadata.formType || "unknown",
          ...metadata.customMetadata,
        },
      },
    });

    // Make the file publicly accessible (or use signed URLs for private access)
    // For documents, we'll use signed URLs for security
    const [signedUrl] = await file.getSignedUrl({
      action: "read",
      expires: "03-01-2030", // Long expiry for document storage
    });

    console.log(`✅ File uploaded to Firebase Storage: ${destinationPath}`);

    return {
      success: true,
      url: signedUrl,
      storagePath: destinationPath,
      bucket: STORAGE_BUCKET,
    };
  } catch (error) {
    console.error("🚨 Firebase Storage upload failed:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Upload a file buffer to Firebase Storage
 * @param {Buffer} buffer - File buffer
 * @param {string} destinationPath - Path in Firebase Storage
 * @param {Object} metadata - Optional metadata for the file
 * @returns {Promise<{success: boolean, url?: string, storagePath?: string, error?: string}>}
 */
const uploadBufferToStorage = async (
  buffer,
  destinationPath,
  metadata = {}
) => {
  try {
    console.log(`📤 Uploading buffer to Firebase Storage: ${destinationPath}`);

    const bucket = getBucket();
    const file = bucket.file(destinationPath);

    // Save buffer to file
    await file.save(buffer, {
      metadata: {
        contentType: metadata.contentType || "application/octet-stream",
        metadata: {
          originalName: metadata.originalName || "unknown",
          uploadedBy: metadata.userId || "unknown",
          uploadedAt: new Date().toISOString(),
          formType: metadata.formType || "unknown",
          ...metadata.customMetadata,
        },
      },
    });

    // Get signed URL
    const [signedUrl] = await file.getSignedUrl({
      action: "read",
      expires: "03-01-2030",
    });

    console.log(`✅ Buffer uploaded to Firebase Storage: ${destinationPath}`);

    return {
      success: true,
      url: signedUrl,
      storagePath: destinationPath,
      bucket: STORAGE_BUCKET,
    };
  } catch (error) {
    console.error("🚨 Firebase Storage buffer upload failed:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Delete a file from Firebase Storage
 * @param {string} storagePath - Path to the file in Firebase Storage
 * @returns {Promise<{success: boolean, error?: string}>}
 */
const deleteFromStorage = async (storagePath) => {
  try {
    console.log(`🗑️ Deleting from Firebase Storage: ${storagePath}`);

    const bucket = getBucket();
    await bucket.file(storagePath).delete();

    console.log(`✅ File deleted from Firebase Storage: ${storagePath}`);
    return { success: true };
  } catch (error) {
    console.error("🚨 Firebase Storage delete failed:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Delete a local file after successful upload
 * @param {string} localFilePath - Path to the local file
 * @returns {Promise<{success: boolean, error?: string}>}
 */
const deleteLocalFile = async (localFilePath) => {
  try {
    if (fs.existsSync(localFilePath)) {
      fs.unlinkSync(localFilePath);
      console.log(`🧹 Local file deleted: ${localFilePath}`);
      return { success: true };
    }
    return { success: true, message: "File already deleted" };
  } catch (error) {
    console.error("🚨 Failed to delete local file:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Generate a storage path for a document
 * @param {string} userId - User ID
 * @param {string} formType - Type of form/document
 * @param {string} originalFilename - Original filename
 * @returns {string} Storage path
 */
const generateStoragePath = (userId, formType, originalFilename) => {
  const timestamp = Date.now();
  const extension = path.extname(originalFilename);
  const sanitizedName = path
    .basename(originalFilename, extension)
    .replace(/[^a-zA-Z0-9-_]/g, "_")
    .substring(0, 50);

  return `documents/${userId}/${formType}/${sanitizedName}_${timestamp}${extension}`;
};

/**
 * Get a fresh signed URL for a file (for when URLs expire)
 * @param {string} storagePath - Path to the file in Firebase Storage
 * @param {number} expiresInMinutes - URL expiration time in minutes (default: 60)
 * @returns {Promise<{success: boolean, url?: string, error?: string}>}
 */
const getSignedUrl = async (storagePath, expiresInMinutes = 60) => {
  try {
    const bucket = getBucket();
    const file = bucket.file(storagePath);

    const [signedUrl] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + expiresInMinutes * 60 * 1000,
    });

    return {
      success: true,
      url: signedUrl,
    };
  } catch (error) {
    console.error("🚨 Failed to generate signed URL:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
};

module.exports = {
  uploadToStorage,
  uploadBufferToStorage,
  deleteFromStorage,
  deleteLocalFile,
  generateStoragePath,
  getSignedUrl,
  getBucket,
  STORAGE_BUCKET,
};

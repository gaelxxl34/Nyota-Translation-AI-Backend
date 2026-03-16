// Image compression service for NTC platform
// Compresses uploaded images before storage to reduce costs
// Uses sharp for high-quality image processing

const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

// Compression settings by tier
const COMPRESSION_PRESETS = {
  // For AI processing — high quality, moderate compression
  ai_input: {
    maxWidth: 2048,
    maxHeight: 2048,
    quality: 85,
    format: "jpeg",
  },
  // For stored originals — good quality, better compression
  storage: {
    maxWidth: 1600,
    maxHeight: 2400,
    quality: 75,
    format: "jpeg",
  },
  // For thumbnails/previews
  thumbnail: {
    maxWidth: 400,
    maxHeight: 600,
    quality: 60,
    format: "jpeg",
  },
};

/**
 * Compress an image file on disk
 * @param {string} inputPath - Path to original image
 * @param {string} preset - Compression preset name (ai_input, storage, thumbnail)
 * @returns {Promise<{outputPath: string, originalSize: number, compressedSize: number, ratio: string}>}
 */
const compressImage = async (inputPath, preset = "storage") => {
  const config = COMPRESSION_PRESETS[preset] || COMPRESSION_PRESETS.storage;
  const ext = path.extname(inputPath).toLowerCase();

  // Skip non-image files (PDFs handled separately)
  if (![".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)) {
    return { outputPath: inputPath, skipped: true, reason: "not an image" };
  }

  const originalSize = fs.statSync(inputPath).size;
  const outputPath = inputPath.replace(/(\.\w+)$/, `_compressed.jpg`);

  try {
    await sharp(inputPath)
      .resize(config.maxWidth, config.maxHeight, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: config.quality, mozjpeg: true })
      .toFile(outputPath);

    const compressedSize = fs.statSync(outputPath).size;
    const ratio = ((1 - compressedSize / originalSize) * 100).toFixed(1);

    console.log(
      `🗜️ Compressed: ${path.basename(inputPath)} — ${formatBytes(originalSize)} → ${formatBytes(compressedSize)} (${ratio}% reduction)`
    );

    return {
      outputPath,
      originalSize,
      compressedSize,
      ratio: `${ratio}%`,
    };
  } catch (error) {
    console.error(`🚨 Compression failed for ${inputPath}:`, error.message);
    // Return original on failure
    return { outputPath: inputPath, skipped: true, reason: error.message };
  }
};

/**
 * Compress an image buffer in memory
 * @param {Buffer} buffer - Image buffer
 * @param {string} preset - Compression preset name
 * @returns {Promise<{buffer: Buffer, originalSize: number, compressedSize: number, ratio: string}>}
 */
const compressBuffer = async (buffer, preset = "storage") => {
  const config = COMPRESSION_PRESETS[preset] || COMPRESSION_PRESETS.storage;
  const originalSize = buffer.length;

  try {
    const compressed = await sharp(buffer)
      .resize(config.maxWidth, config.maxHeight, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: config.quality, mozjpeg: true })
      .toBuffer();

    const ratio = ((1 - compressed.length / originalSize) * 100).toFixed(1);

    console.log(
      `🗜️ Buffer compressed: ${formatBytes(originalSize)} → ${formatBytes(compressed.length)} (${ratio}% reduction)`
    );

    return {
      buffer: compressed,
      originalSize,
      compressedSize: compressed.length,
      ratio: `${ratio}%`,
    };
  } catch (error) {
    console.error(`🚨 Buffer compression failed:`, error.message);
    return { buffer, originalSize, compressedSize: originalSize, ratio: "0%", skipped: true };
  }
};

/**
 * Get image metadata (dimensions, format, size)
 * @param {string|Buffer} input - File path or buffer
 * @returns {Promise<Object>} Image metadata
 */
const getImageInfo = async (input) => {
  try {
    const metadata = await sharp(input).metadata();
    return {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      size: metadata.size,
      channels: metadata.channels,
    };
  } catch (error) {
    return null;
  }
};

/**
 * Clean up a compressed file from disk
 */
const cleanupCompressed = (compressedPath) => {
  try {
    if (compressedPath && compressedPath.includes("_compressed") && fs.existsSync(compressedPath)) {
      fs.unlinkSync(compressedPath);
    }
  } catch {
    // Silent cleanup
  }
};

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
};

module.exports = {
  COMPRESSION_PRESETS,
  compressImage,
  compressBuffer,
  getImageInfo,
  cleanupCompressed,
};

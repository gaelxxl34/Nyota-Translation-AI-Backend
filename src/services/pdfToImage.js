// PDF-to-Image Conversion Service for NTC
// Converts PDF pages to images for better AI extraction accuracy
// Uses pdf2pic (GraphicsMagick/ImageMagick based) or falls back to sending PDF directly

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

/**
 * Convert PDF to images using pdf-poppler (if available) or skip and let AI handle PDF directly
 *
 * Strategy:
 * - For single-page PDFs: return the PDF as-is (GPT-4o handles these well)
 * - For multi-page PDFs: attempt conversion to images for better accuracy
 * - If conversion tools aren't available: fall back to sending PDF directly to AI
 *
 * @param {string} pdfPath - Path to the PDF file
 * @param {Object} options - Conversion options
 * @param {number} [options.dpi=200] - Resolution for conversion
 * @param {string} [options.format='jpeg'] - Output format
 * @param {number} [options.quality=85] - JPEG quality
 * @returns {Promise<{images: Array<{path: string, page: number}>, isConverted: boolean}>}
 */
const convertPdfToImages = async (pdfPath, options = {}) => {
  const { dpi = 200, format = "jpeg", quality = 85 } = options;

  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF file not found: ${pdfPath}`);
  }

  const ext = path.extname(pdfPath).toLowerCase();
  if (ext !== ".pdf") {
    // Not a PDF — return as-is (it's already an image)
    return { images: [{ path: pdfPath, page: 1 }], isConverted: false };
  }

  // Try using sharp to get PDF info (sharp can read first page of PDFs)
  try {
    const metadata = await sharp(pdfPath, { pages: -1 }).metadata();
    const pageCount = metadata.pages || 1;

    console.log(`📄 PDF has ${pageCount} page(s), converting at ${dpi}dpi...`);

    const images = [];
    const outputDir = path.dirname(pdfPath);

    for (let i = 0; i < pageCount; i++) {
      const outputPath = path.join(
        outputDir,
        `${path.basename(pdfPath, ".pdf")}_page${i + 1}.jpg`
      );

      await sharp(pdfPath, { page: i, density: dpi })
        .jpeg({ quality })
        .toFile(outputPath);

      images.push({ path: outputPath, page: i + 1 });
    }

    console.log(`✅ Converted ${pageCount} PDF page(s) to images`);
    return { images, isConverted: true, pageCount };
  } catch (error) {
    // Sharp PDF support requires libvips with poppler — may not be available
    console.warn(`⚠️ PDF-to-image conversion not available (${error.message}), using PDF directly`);
    return { images: [{ path: pdfPath, page: 1 }], isConverted: false };
  }
};

/**
 * Clean up converted images after processing
 * @param {Array<{path: string}>} images - Array of image objects from convertPdfToImages
 * @param {boolean} wasConverted - Whether images were actually converted (to avoid deleting originals)
 */
const cleanupConvertedImages = (images, wasConverted) => {
  if (!wasConverted) return;

  for (const img of images) {
    try {
      if (fs.existsSync(img.path)) {
        fs.unlinkSync(img.path);
      }
    } catch {
      // Silent cleanup
    }
  }
};

module.exports = {
  convertPdfToImages,
  cleanupConvertedImages,
};

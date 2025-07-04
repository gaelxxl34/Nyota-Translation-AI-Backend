// Multer Upload Middleware for NTC
// Handles file uploads and stores them in the uploads/ directory

const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, "../../uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log("📁 Created uploads directory:", uploadsDir);
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename with timestamp and original extension
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const extension = path.extname(file.originalname);
    const filename = `bulletin-${uniqueSuffix}${extension}`;
    cb(null, filename);
  },
});

// File filter to allow only specific file types
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
    "application/pdf",
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Invalid file type: ${file.mimetype}. Allowed: JPEG, PNG, GIF, WebP, PDF`
      ),
      false
    );
  }
};

// Configure multer with options
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1, // Only allow single file upload
  },
});

// Error handling middleware for multer
const handleMulterError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case "LIMIT_FILE_SIZE":
        return res.status(400).json({
          error: "File too large",
          details: "Maximum file size is 10MB",
          code: "FILE_TOO_LARGE",
        });
      case "LIMIT_FILE_COUNT":
        return res.status(400).json({
          error: "Too many files",
          details: "Only one file can be uploaded at a time",
          code: "TOO_MANY_FILES",
        });
      case "LIMIT_UNEXPECTED_FILE":
        return res.status(400).json({
          error: "Unexpected file field",
          details: 'File must be uploaded with field name "file"',
          code: "UNEXPECTED_FIELD",
        });
      default:
        return res.status(400).json({
          error: "Upload error",
          details: error.message,
          code: "UPLOAD_ERROR",
        });
    }
  }

  // Handle custom file filter errors
  if (error.message.includes("Invalid file type")) {
    return res.status(400).json({
      error: "Invalid file type",
      details: error.message,
      code: "INVALID_FILE_TYPE",
    });
  }

  // Pass other errors to global error handler
  next(error);
};

module.exports = {
  upload,
  handleMulterError,
};

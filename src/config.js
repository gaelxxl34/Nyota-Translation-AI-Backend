// Configuration for NTC Backend
// Allows easy switching between development and production settings

const config = {
  // OpenAI Configuration
  openai: {
    // Set to true to use mock OpenAI responses for testing
    // Set to false to use real OpenAI API (requires valid API key and quota)
    useMock: process.env.USE_OPENAI_MOCK === "true" || false,

    // API settings
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS) || 4000, // Increased for larger responses
    temperature: parseFloat(process.env.OPENAI_TEMPERATURE) || 0.1,
  },

  // Server Configuration
  server: {
    port: process.env.PORT || 3002,
    nodeEnv: process.env.NODE_ENV || "development",
  },

  // Upload Configuration
  upload: {
    maxFileSize: 10 * 1024 * 1024, // 10MB
    allowedMimeTypes: [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "application/pdf",
    ],
  },
};

module.exports = config;

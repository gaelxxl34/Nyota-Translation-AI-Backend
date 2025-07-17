// Environment Configuration for NTC Backend
// Centralized configuration management with validation

require("dotenv").config();

const config = {
  // Server Configuration
  server: {
    port: process.env.PORT || 3001,
    nodeEnv: process.env.NODE_ENV || "development",
  },

  // Frontend Configuration
  frontend: {
    url: process.env.FRONTEND_URL || "http://localhost:5173",
    urlAlt: process.env.FRONTEND_URL_ALT || "http://localhost:5174",
    urlProd: process.env.FRONTEND_URL_PROD || "https://nyotatranslate.com/",
  },

  // CORS Configuration
  cors: {
    origins: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(",").map((origin) => origin.trim())
      : [
          "http://localhost:5173",
          "http://localhost:5174",
          "http://localhost:3000",
          "https://nyotatranslate.com",
          "https://www.nyotatranslate.com",
        ],
  },

  // OpenAI Configuration
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    useMock: process.env.USE_OPENAI_MOCK === "true",
  },

  // Firebase Configuration
  firebase: {
    serviceAccountKeyPath:
      process.env.SERVICE_ACCOUNT_KEY_PATH || "config/serviceAccountKey.json",
    projectId: process.env.FIREBASE_PROJECT_ID || "ntc-app-7ac7e",
  },

  // Database Configuration
  database: {
    url: process.env.DATABASE_URL,
  },

  // Validation
  validate() {
    const required = [
      { key: "OPENAI_API_KEY", value: this.openai.apiKey },
      { key: "FIREBASE_PROJECT_ID", value: this.firebase.projectId },
    ];

    const missing = required.filter(({ value }) => !value);

    if (missing.length > 0) {
      console.error("❌ Missing required environment variables:");
      missing.forEach(({ key }) => console.error(`   - ${key}`));

      if (this.server.nodeEnv === "production") {
        process.exit(1);
      } else {
        console.warn("⚠️ Running in development mode with missing variables");
      }
    }

    console.log("✅ Environment configuration loaded:");
    console.log(`   - Node Environment: ${this.server.nodeEnv}`);
    console.log(`   - Server Port: ${this.server.port}`);
    console.log(`   - Frontend URL: ${this.frontend.url}`);
    console.log(`   - CORS Origins: ${this.cors.origins.join(", ")}`);
    console.log(`   - OpenAI Mock Mode: ${this.openai.useMock}`);
    console.log(`   - Firebase Project: ${this.firebase.projectId}`);
  },
};

// Validate configuration on load
config.validate();

module.exports = config;

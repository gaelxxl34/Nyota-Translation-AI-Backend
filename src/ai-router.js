// AI Router for NTC - Smart routing to appropriate AI provider
// Claude for DRC bulletins, OpenAI for everything else
// Supports language auto-detection and multi-language documents

const { extractBulletinWithClaude, extractGeneralDocumentWithClaude } = require("./anthropic");
const {
  uploadAndExtractWithOpenAI,
  detectDocumentLanguage,
} = require("./openai");
const { getAiProvider } = require("./config/documentTypes");
const { isLanguageSupported, isPairSupported } = require("./constants/languages");

/**
 * Route document processing to the appropriate AI provider
 *
 * ROUTING LOGIC:
 * - Form 4 & Form 6 (DRC bulletins) → Claude Sonnet 4 (better at complex tables)
 * - generalDocument (any language) → Claude Sonnet 4 (better at layout-aware extraction)
 * - All DRC handcrafted docs → OpenAI GPT-4o with DRC-specific prompts
 *
 * LANGUAGE FLOW:
 * - DRC documents: sourceLanguage is always French (hardcoded)
 * - generalDocument: sourceLanguage auto-detected by AI or passed explicitly
 * - Arabic/Spanish/other: routed through generalDocument with auto-detection
 *
 * @param {string} filePath - Path to the uploaded file
 * @param {string} formType - Type of form to process
 * @param {Object} options - Processing options
 * @param {string} [options.sourceLanguage] - Source language code (fr, ar, es) or 'auto'
 * @param {string} [options.targetLanguage] - Target language (default: 'english')
 * @returns {Promise<Object>} Extraction result with data and metadata
 */
const processDocument = async (filePath, formType = "form6", options = {}) => {
  const sourceLanguage = options.sourceLanguage || "auto";
  const targetLanguage = options.targetLanguage || "english";

  console.log(`🤖 AI Router: Processing ${formType} from ${filePath}`);
  console.log(`   Source language: ${sourceLanguage}, Target: ${targetLanguage}`);

  try {
    // Route DRC bulletins to Claude (better at table extraction)
    if (formType === "form4" || formType === "form6") {
      console.log("📍 Routing to Claude Sonnet 4 (DRC bulletin extraction)");
      return await extractBulletinWithClaude(filePath, formType);
    }

    // Route general documents to Claude (better at layout-aware extraction)
    if (formType === "generalDocument") {
      console.log("📍 Routing to Claude Sonnet 4 (general document extraction)");
      return await extractGeneralDocumentWithClaude(filePath, {
        ...options,
        sourceLanguage,
        targetLanguage,
      });
    }

    // All other DRC-specific documents → OpenAI GPT-4o
    const aiProvider = getAiProvider(formType);
    console.log(
      `📍 Routing to ${aiProvider === "claude" ? "Claude" : "OpenAI GPT-4o"} (${formType})`,
    );

    return await uploadAndExtractWithOpenAI(filePath, formType, {
      ...options,
      sourceLanguage,
      targetLanguage,
    });
  } catch (error) {
    console.error(`❌ AI Router error for ${formType}:`, error.message);
    throw error;
  }
};

module.exports = {
  processDocument,
};

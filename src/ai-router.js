// AI Router for NTC - Smart routing to appropriate AI provider
// Simple, clear logic: Claude for bulletins, OpenAI for diplomas/attestations

const { extractBulletinWithClaude } = require("./anthropic");
const { uploadAndExtractWithOpenAI } = require("./openai");

/**
 * Route document processing to the appropriate AI provider
 *
 * ROUTING LOGIC:
 * - Form 4 & Form 6 (bulletins) → Claude Sonnet 4 (better at complex tables)
 * - All other documents → OpenAI GPT-4o (diplomas, attestations, transcripts)
 *
 * @param {string} filePath - Path to the uploaded file
 * @param {string} formType - Type of form to process
 * @returns {Promise<Object>} Extraction result with data and metadata
 */
const processDocument = async (filePath, formType = "form6", options = {}) => {
  console.log(`🤖 AI Router: Processing ${formType} from ${filePath}`);

  try {
    // Route bulletins to Claude (better at table extraction)
    if (formType === "form4" || formType === "form6") {
      console.log("📍 Routing to Claude Sonnet 4 (bulletin extraction)");
      return await extractBulletinWithClaude(filePath, formType);
    }

    // Route everything else to OpenAI
    console.log(
      "📍 Routing to OpenAI GPT-4o (diploma/attestation/general document extraction)",
    );

    // - stateDiploma
    // - bachelorDiploma
    // - collegeTranscript
    // - collegeAttestation
    // - highSchoolAttestation
    // - generalDocument (PDF multi-page document translation)
    return await uploadAndExtractWithOpenAI(filePath, formType, options);
  } catch (error) {
    console.error(`❌ AI Router error for ${formType}:`, error.message);
    throw error;
  }
};

module.exports = {
  processDocument,
};

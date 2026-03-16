// Document type definitions organized by region/country
// Hand-crafted templates (DRC) vs AI-learned vs fully dynamic

const TEMPLATE_MODE = {
  HANDCRAFTED: "handcrafted", // Pre-built templates (DRC bulletins, diplomas)
  AI_LEARNED: "ai_learned", // AI extracts layout, we cache for reuse
  DYNAMIC: "dynamic", // Fully AI-driven, no template needed
};

// DRC-specific document types (hand-crafted templates exist)
const DRC_DOCUMENTS = {
  form4: {
    id: "form4",
    label: "Primary School Bulletin (Form 4)",
    region: "drc",
    sourceLanguage: "fr",
    templateMode: TEMPLATE_MODE.HANDCRAFTED,
    aiProvider: "claude", // Claude Sonnet 4 for DRC bulletins
    description: "DRC primary school report card — semester grades",
  },
  form6: {
    id: "form6",
    label: "Secondary School Bulletin (Form 6)",
    region: "drc",
    sourceLanguage: "fr",
    templateMode: TEMPLATE_MODE.HANDCRAFTED,
    aiProvider: "claude",
    description: "DRC secondary school report card — semester grades",
  },
  stateDiploma: {
    id: "stateDiploma",
    label: "State Diploma (Diplôme d'État)",
    region: "drc",
    sourceLanguage: "fr",
    templateMode: TEMPLATE_MODE.HANDCRAFTED,
    aiProvider: "openai",
    description: "DRC national high school diploma",
  },
  stateExamAttestation: {
    id: "stateExamAttestation",
    label: "State Exam Attestation",
    region: "drc",
    sourceLanguage: "fr",
    templateMode: TEMPLATE_MODE.HANDCRAFTED,
    aiProvider: "openai",
    description: "DRC state examination attestation letter",
  },
  bachelorDiploma: {
    id: "bachelorDiploma",
    label: "Bachelor's Degree Diploma",
    region: "drc",
    sourceLanguage: "fr",
    templateMode: TEMPLATE_MODE.HANDCRAFTED,
    aiProvider: "openai",
    description: "DRC university bachelor's degree diploma",
  },
  collegeTranscript: {
    id: "collegeTranscript",
    label: "College Transcript (Relevé de Notes)",
    region: "drc",
    sourceLanguage: "fr",
    templateMode: TEMPLATE_MODE.HANDCRAFTED,
    aiProvider: "openai",
    description: "DRC university transcript with course grades",
  },
  collegeAttestation: {
    id: "collegeAttestation",
    label: "College Attestation",
    region: "drc",
    sourceLanguage: "fr",
    templateMode: TEMPLATE_MODE.HANDCRAFTED,
    aiProvider: "openai",
    description: "DRC university enrollment/completion attestation",
  },
  highSchoolAttestation: {
    id: "highSchoolAttestation",
    label: "High School Attestation",
    region: "drc",
    sourceLanguage: "fr",
    templateMode: TEMPLATE_MODE.HANDCRAFTED,
    aiProvider: "openai",
    description: "DRC high school attestation letter",
  },
};

// General/multi-region document type (fully dynamic — AI detects layout)
const GENERAL_DOCUMENTS = {
  generalDocument: {
    id: "generalDocument",
    label: "General Academic Document",
    region: "any",
    sourceLanguage: "auto", // AI auto-detects
    templateMode: TEMPLATE_MODE.DYNAMIC,
    aiProvider: "openai",
    description: "Any academic document — AI auto-detects language, type, and layout",
  },
};

// All document types combined
const ALL_DOCUMENT_TYPES = {
  ...DRC_DOCUMENTS,
  ...GENERAL_DOCUMENTS,
};

// Valid form type IDs (for request validation)
const VALID_FORM_TYPES = Object.keys(ALL_DOCUMENT_TYPES);

const getDocumentType = (formType) => {
  return ALL_DOCUMENT_TYPES[formType] || null;
};

const getAiProvider = (formType) => {
  const doc = ALL_DOCUMENT_TYPES[formType];
  return doc ? doc.aiProvider : "openai";
};

const getDocumentsByRegion = (region) => {
  return Object.values(ALL_DOCUMENT_TYPES).filter(
    (doc) => doc.region === region || doc.region === "any"
  );
};

const getDocumentsByLanguage = (langCode) => {
  return Object.values(ALL_DOCUMENT_TYPES).filter(
    (doc) => doc.sourceLanguage === langCode || doc.sourceLanguage === "auto"
  );
};

module.exports = {
  TEMPLATE_MODE,
  DRC_DOCUMENTS,
  GENERAL_DOCUMENTS,
  ALL_DOCUMENT_TYPES,
  VALID_FORM_TYPES,
  getDocumentType,
  getAiProvider,
  getDocumentsByRegion,
  getDocumentsByLanguage,
};

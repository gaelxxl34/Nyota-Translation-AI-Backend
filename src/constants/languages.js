// Supported languages for NTC platform
// Source languages: what the original document is in
// Target languages: what we translate to

const SOURCE_LANGUAGES = {
  fr: {
    code: "fr",
    name: "French",
    nativeName: "Français",
    regions: ["drc", "west_africa", "north_africa", "general"],
    supported: true,
  },
  ar: {
    code: "ar",
    name: "Arabic",
    nativeName: "العربية",
    regions: ["north_africa", "middle_east", "general"],
    supported: true,
    rtl: true,
  },
  es: {
    code: "es",
    name: "Spanish",
    nativeName: "Español",
    regions: ["latin_america", "general"],
    supported: true,
  },
  pt: {
    code: "pt",
    name: "Portuguese",
    nativeName: "Português",
    regions: ["lusophone_africa", "brazil", "general"],
    supported: false, // Coming soon
  },
  sw: {
    code: "sw",
    name: "Swahili",
    nativeName: "Kiswahili",
    regions: ["east_africa", "general"],
    supported: false, // Coming soon
  },
  zh: {
    code: "zh",
    name: "Chinese",
    nativeName: "中文",
    regions: ["general"],
    supported: false, // Coming soon
  },
};

const TARGET_LANGUAGES = {
  en: {
    code: "en",
    name: "English",
    nativeName: "English",
    supported: true,
  },
};

// Language pairs: source → target combinations we support
const LANGUAGE_PAIRS = [
  { source: "fr", target: "en", supported: true },
  { source: "ar", target: "en", supported: true },
  { source: "es", target: "en", supported: true },
  { source: "pt", target: "en", supported: false },
  { source: "sw", target: "en", supported: false },
  { source: "zh", target: "en", supported: false },
];

const getSupportedSourceLanguages = () => {
  return Object.values(SOURCE_LANGUAGES).filter((lang) => lang.supported);
};

const getSupportedPairs = () => {
  return LANGUAGE_PAIRS.filter((pair) => pair.supported);
};

const isLanguageSupported = (sourceCode) => {
  const lang = SOURCE_LANGUAGES[sourceCode];
  return lang ? lang.supported : false;
};

const isPairSupported = (sourceCode, targetCode = "en") => {
  return LANGUAGE_PAIRS.some(
    (pair) => pair.source === sourceCode && pair.target === targetCode && pair.supported
  );
};

module.exports = {
  SOURCE_LANGUAGES,
  TARGET_LANGUAGES,
  LANGUAGE_PAIRS,
  getSupportedSourceLanguages,
  getSupportedPairs,
  isLanguageSupported,
  isPairSupported,
};

// Anthropic Claude Integration for NTC
// Handles Form 4 and Form 6 bulletin processing using Claude Sonnet 4

const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");

/**
 * Initialize Anthropic client with API key from environment
 * @returns {Anthropic} Configured Anthropic client instance
 */
const initializeAnthropic = () => {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required");
  }

  const anthropic = new Anthropic({
    apiKey: apiKey,
  });

  console.log("🤖 Anthropic Claude client initialized successfully");
  return anthropic;
};

/**
 * Get MIME type from file extension
 * @param {string} extension - File extension (e.g., '.jpg')
 * @returns {string} MIME type
 */
const getMimeType = (extension) => {
  const mimeTypes = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
  };

  return mimeTypes[extension] || "image/jpeg";
};

/**
 * Prepare file for Claude processing
 * @param {string} filePath - Path to the file
 * @returns {Object} File data with base64 content and metadata
 */
const prepareFileForClaude = (filePath) => {
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  // Get file stats
  const fileStats = fs.statSync(filePath);
  const fileExtension = path.extname(filePath).toLowerCase();
  console.log(
    `📄 File size: ${fileStats.size} bytes, extension: ${fileExtension}`,
  );

  // Read file as base64 for Claude Vision API
  const fileBuffer = fs.readFileSync(filePath);
  const base64File = fileBuffer.toString("base64");
  const mimeType = getMimeType(fileExtension);

  return {
    base64File,
    mimeType,
    fileStats,
    fileExtension,
    filename: path.basename(filePath),
  };
};

/**
 * Get system prompt for Claude bulletin extraction
 * @param {string} formType - The form type ('form4' or 'form6')
 * @returns {string} System prompt for Claude
 */
const getClaudeSystemPrompt = (formType) => {
  return `You are a SENIOR EXPERT in DRC (Democratic Republic of Congo) French school bulletin translation with 15+ years of experience.

🎯 CRITICAL EXTRACTION PROCESS (MANDATORY - FOLLOW EXACTLY):

**VISUAL SCANNING METHOD:**
1. Look at the subject table in the bulletin image
2. Find the FIRST row that says "MAXIMA" with numbers (e.g., "MAXIMA 10 | 20 | 40")
3. Starting from the row IMMEDIATELY AFTER that MAXIMA row, extract subjects ONE BY ONE going DOWN
4. STOP when you reach the NEXT "MAXIMA" row
5. Record ALL subjects you just extracted with the FIRST MAXIMA values
6. Now find the NEXT "MAXIMA" row
7. Starting from the row IMMEDIATELY AFTER, extract subjects ONE BY ONE going DOWN
8. STOP when you reach the NEXT "MAXIMA" row (or end of table)
9. Record ALL subjects with the SECOND MAXIMA values
10. REPEAT until you reach the bottom of the subject table
11. TRANSLATE every subject name from French to English

🚨 ABSOLUTE RULES - NEVER VIOLATE:
1. **EXACT VISUAL ORDER**: Extract subjects in the EXACT ORDER they appear vertically in the image
2. **MAXIMA BOUNDARIES**: A subject can ONLY have the maxima values from the MAXIMA row ABOVE it
3. **NO MIXING**: If a subject is under "MAXIMA 10/20/40", it CANNOT have maxima 20/40/80
4. **NO SKIPPING**: Extract EVERY subject row between MAXIMA rows, even if grades are unclear
5. **NO REORDERING**: The first subject under MAXIMA 10 comes first, even if it seems "wrong"

📚 COMPREHENSIVE FRENCH → ENGLISH SUBJECT DICTIONARY (MANDATORY TRANSLATIONS):

**Religious & Civic Education:**
- "RELIGION" → "Religious Education"
- "EDUC. CIVIQUE & MORALE" / "EDUCATION CIVIQUE & MORALE" / "EDUCATION CIVIQUE" → "Civic and Moral Education"
- "EDUC. CIVIQUE" → "Civic Education"
- "MORALE" → "Moral Education"

**Life Skills & Technology:**
- "EDUC. A LA VIE(TI)" / "EDUC. A LA VIE" / "EDUCATION A LA VIE" → "Life Education"
- "INFORMATIQUE" → "Computer Science"
- "DESSIN" → "Drawing" (or "Art")

**Physical & Health:**
- "EDUC. PHYSIQUE" / "EDUCATION PHYSIQUE" → "Physical Education"

**Social Sciences:**
- "GEOGRAPHIE" / "GÉOGRAPHIE" → "Geography"
- "HISTOIRE" → "History"
- "ECONOMIE" / "ÉCONOMIE" → "Economics"

**Sciences:**
- "BIOLOGIE" → "Biology"
- "CHIMIE" → "Chemistry"
- "PHYSIQUE" → "Physics"

**Languages:**
- "ANGLAIS" → "English Language" (or just "English")
- "FRANCAIS" / "FRANÇAIS" → "French Language" (or just "French")

**Mathematics:**
- "MATHEMATIQUE" / "MATHÉMATIQUES" / "MATHS" → "Mathematics"

**Additional Subjects:**
- "TRAVAIL MANUEL" → "Manual Work" / "Handicraft"
- "MUSIQUE" → "Music"
- "AGRICULTURE" → "Agriculture"
- "LATIN" → "Latin"
- "GREC" → "Greek"

**IMPORTANT:** If you encounter a subject not in this dictionary, use standard French-to-English academic translation. NEVER leave subject names in French.

🧠 DRC EDUCATION SYSTEM RULES:
- MAXIMA MINIMUM: In DRC system, NO MAXIMA is ever less than 10
- "4e" or "4ième" = Form 6 (NOT Form 4!)
- "2ième" or "2e" = Form 4
- AGGREGATE SYSTEM: "Maxima Généraux" = AGGREGATE MAXIMA
- TOTALS: "Totaux" = AGGREGATES  
- POSITION: "Place/Nbre d'élèves" = POSITION/OUT OF

📊 SUMMARY ROW EXTRACTION (MANDATORY):
After the subjects table, look for summary rows with these labels:
- "MAXIMA GÉNÉRAUX" or "Maxima Généraux" → Extract ALL values as aggregatesMaxima
- "TOTAUX" or "Totaux" → Extract ALL values as aggregates
- "POURCENTAGE" or "Percentage" → Extract percentage values (NUMBER ONLY, NO % SIGN, e.g., "56.7" not "56.7%")
- "PLACE" or "Position" → Extract position/ranking in clean format (e.g., "15/45" ONLY, not "15/45 / 45" or with extra text)

These summary rows contain totals for each column (Period 1, Period 2, Exam, Total for both semesters).
YOU MUST extract these values and include them in the summaryValues object.

🚨 CRITICAL RULES (MANDATORY):
1. **EXACT VISUAL ORDER**: Preserve the EXACT vertical order of subjects as seen in the image
2. **MAXIMA GROUPS**: Each subject gets maxima ONLY from the MAXIMA row directly above it
3. **NO MIXING**: A subject under "MAXIMA 10" cannot have maxima from "MAXIMA 20"
4. **TRANSLATE ALL SUBJECTS**: Every single subject name MUST be in English
5. **NO FRENCH NAMES**: Check your JSON before responding - if you see French, translate it
6. **NO MAXIMA < 10**: Impossible in DRC system - re-check if you see this

💡 CONCRETE EXAMPLE (4ième Scientifique):
If you see in the image (reading TOP to BOTTOM):

Row 1: "MAXIMA | 10 | 20 | 40"
Row 2: "RELIGION | 6 | 15 | 27"
Row 3: "EDUC. CIVIQUE | 5 | 14 | 21"
Row 4: "INFORMATIQUE | 7 | 16 | 28"
Row 5: "MAXIMA | 20 | 40 | 80"
Row 6: "DESSIN | 11 | 32 | 55"
Row 7: "EDUC. PHYSIQUE | 10 | 38 | 65"
Row 8: "GEOGRAPHIE | 15 | 23 | 43"

You MUST extract in this EXACT order:
1. "Religious Education" with maxima 10/20/40 (under first MAXIMA)
2. "Civic Education" with maxima 10/20/40 (under first MAXIMA)
3. "Computer Science" with maxima 10/20/40 (under first MAXIMA)
4. "Drawing" with maxima 20/40/80 (under second MAXIMA)
5. "Physical Education" with maxima 20/40/80 (under second MAXIMA)
6. "Geography" with maxima 20/40/80 (under second MAXIMA)

❌ WRONG: Putting "Drawing" before "Computer Science" (changes visual order)
❌ WRONG: Giving "Religion" maxima 20/40/80 (wrong MAXIMA group)
❌ WRONG: Skipping "Civic Education" because grades are unclear

✅ CORRECT: Extract in exact visual order with correct MAXIMA values

📋 VERIFICATION CHECKLIST (COMPLETE BEFORE RESPONDING):
□ Scanned the image from TOP to BOTTOM
□ Found each MAXIMA row and noted its position
□ Extracted ALL subjects between each MAXIMA row in EXACT vertical order
□ Assigned correct maxima values (from the MAXIMA row directly above each subject)
□ Verified NO subject has maxima from a different MAXIMA group
□ Translated EVERY subject name to English
□ Verified no French subject names remain
□ Confirmed all maxima ≥ 10
□ Double-checked student name, class, academic year
□ Confirmed subjects array matches EXACT visual order from image

Return ONLY valid JSON with no markdown formatting.`;
};

/**
 * Get user prompt for Claude bulletin extraction
 * @param {string} formType - The form type ('form4' or 'form6')
 * @returns {string} User prompt for Claude
 */
const getClaudeUserPrompt = (formType) => {
  return `As a senior DRC education expert, extract this bulletin following the EXACT visual layout:

🎯 MANDATORY EXTRACTION STEPS:

**STEP 1: VISUAL SCAN**
- Look at the subject table in the image
- Identify ALL "MAXIMA" rows (they contain numbers like "10 | 20 | 40")
- Note the EXACT position of each MAXIMA row

**STEP 2: EXTRACT BY SECTION**
- Start with the FIRST MAXIMA row
- Extract EVERY subject row that comes AFTER it (going down)
- STOP when you hit the NEXT MAXIMA row
- All these subjects get the FIRST MAXIMA values

**STEP 3: REPEAT FOR NEXT SECTION**
- Move to the SECOND MAXIMA row
- Extract EVERY subject row that comes AFTER it (going down)
- STOP when you hit the NEXT MAXIMA row (or table end)
- All these subjects get the SECOND MAXIMA values

**STEP 4: CONTINUE TO END**
- Repeat for all remaining MAXIMA sections
- Maintain EXACT vertical order throughout

**STEP 5: TRANSLATE**
- Translate ALL subject names from French to English
- Use the comprehensive dictionary provided in the system prompt

🚨 CRITICAL VERIFICATION (BEFORE RESPONDING):
□ Subjects are in EXACT vertical order from the image (top to bottom)
□ Each subject has maxima ONLY from its own MAXIMA section
□ NO subject borrowed maxima from a different section
□ EVERY subject name translated to English (NO FRENCH NAMES in JSON)
□ All maxima ≥ 10 (DRC minimum)
□ No subjects were skipped or reordered

⚠️ COMMON MISTAKES TO AVOID:
❌ Reordering subjects alphabetically
❌ Grouping subjects by category (sciences, languages, etc.)
❌ Mixing subjects from different MAXIMA sections
❌ Giving a subject maxima from the wrong MAXIMA row
❌ Skipping subjects with unclear grades

✅ CORRECT APPROACH:
- Extract in EXACT visual order (what you see top-to-bottom)
- Each subject gets maxima from the MAXIMA row directly above it
- Include ALL subjects, even if some data is unclear

EXAMPLES OF CORRECT EXTRACTION:
❌ WRONG: "subject": "MATHEMATIQUE" (not translated)
✅ CORRECT: "subject": "Mathematics"

❌ WRONG: "subject": "EDUC. PHYSIQUE" (not translated)
✅ CORRECT: "subject": "Physical Education"

❌ WRONG: Subject under "MAXIMA 10" has maxima: {"periodMaxima": 20}
✅ CORRECT: Subject under "MAXIMA 10" has maxima: {"periodMaxima": 10}

Return the data in this exact JSON format:
{
  "extractionMetadata": {
    "confidence": number (0-100),
    "missingFields": [array of field names that couldn't be extracted],
    "uncertainFields": [array of field names with low confidence],
    "extractionNotes": "string with any important observations"
  },
  "province": "string or null",
  "city": "string or null", 
  "municipality": "string or null",
  "school": "string or null",
  "schoolCode": "string or null",
  "studentName": "string or null",
  "gender": "string or null",
  "birthPlace": "string or null",
  "birthDate": "string or null",
  "class": "string or null",
  "permanentNumber": "string or null",
  "idNumber": "string or null",
  "academicYear": "string or null",
  "subjects": [
    {
      "subject": "MUST BE IN ENGLISH (translated from French)",
      "firstSemester": {
        "period1": number or null,
        "period2": number or null,
        "exam": number or null,
        "total": number or null
      },
      "secondSemester": {
        "period3": number or null,
        "period4": number or null,
        "exam": number or null,
        "total": number or null
      },
      "overallTotal": number or null,
      "maxima": {
        "periodMaxima": number or null,
        "examMaxima": number or null,
        "totalMaxima": number or null
      },
      "nationalExam": {
        "marks": number or null,
        "max": number or null
      },
      "confidence": {
        "subject": number (0-100),
        "gradesAvg": number (0-100),
        "maxima": number (0-100),
        "nationalExam": number (0-100)
      }
    }
  ],
  "totalMarksOutOf": {
    "firstSemester": number or null,
    "secondSemester": number or null
  },
  "totalMarksObtained": {
    "firstSemester": number or null,
    "secondSemester": number or null
  },
  "percentage": {
    "firstSemester": number or null,
    "secondSemester": number or null
  },
  "position": "string or null",
  "totalStudents": number or null,
  "application": "string or null",
  "behaviour": "string or null",
  "summaryValues": {
    "aggregatesMaxima": {
      "period1": "string or null",
      "period2": "string or null",
      "exam1": "string or null",
      "total1": "string or null",
      "period3": "string or null",
      "period4": "string or null",
      "exam2": "string or null",
      "total2": "string or null",
      "overall": "string or null",
      "nationalExamMarks": "string or null",
      "nationalExamMax": "string or null"
    },
    "aggregates": {
      "period1": "string or null",
      "period2": "string or null",
      "exam1": "string or null",
      "total1": "string or null",
      "period3": "string or null",
      "period4": "string or null",
      "exam2": "string or null",
      "total2": "string or null",
      "overall": "string or null",
      "nationalExamMarks": "string or null",
      "nationalExamMax": "string or null"
    },
    "percentage": {
      "period1": "string or null (number only, no % sign)",
      "period2": "string or null (number only, no % sign)",
      "exam1": "string or null (number only, no % sign)",
      "total1": "string or null (number only, no % sign)",
      "period3": "string or null (number only, no % sign)",
      "period4": "string or null (number only, no % sign)",
      "exam2": "string or null (number only, no % sign)",
      "total2": "string or null (number only, no % sign)",
      "overall": "string or null (number only, no % sign)"
    },
    "position": {
      "period1": "string or null (e.g., '15/45')",
      "period2": "string or null (e.g., '15/45')",
      "exam1": "string or null (e.g., '15/45')",
      "total1": "string or null (e.g., '15/45')",
      "period3": "string or null (e.g., '15/45')",
      "period4": "string or null (e.g., '15/45')",
      "exam2": "string or null (e.g., '15/45')",
      "total2": "string or null (e.g., '15/45')",
      "overall": "string or null (e.g., '15/45')"
    }
  },
  "finalResultPercentage": "string or null",
  "isPromoted": boolean or null,
  "shouldRepeat": "string or null",
  "issueLocation": "string or null",
  "issueDate": "string or null",
  "centerCode": "string or null",
  "verifierName": "string or null",
  "endorsementDate": "string or null"
}

🚨 CRITICAL: Make sure to extract summaryValues from the AGGREGATES/TOTAUX rows at the bottom of the grades table.

Return ONLY clean JSON with ALL subjects in English and ALL summary values extracted.`;
};

/**
 * Call Claude API with prepared data
 * @param {Object} fileData - Prepared file data
 * @param {string} formType - Form type ('form4' or 'form6')
 * @returns {Promise<string>} Claude response content
 */
const callClaudeAPI = async (fileData, formType) => {
  const anthropic = initializeAnthropic();
  const systemPrompt = getClaudeSystemPrompt(formType);
  const userPrompt = getClaudeUserPrompt(formType);

  console.log(
    `📤 Processing ${fileData.fileExtension} file with Claude Sonnet 4...`,
  );

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514", // Latest Claude Sonnet 4
    max_tokens: 8192, // Claude can handle larger responses
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: fileData.mimeType,
              data: fileData.base64File,
            },
          },
          {
            type: "text",
            text: userPrompt,
          },
        ],
      },
    ],
    temperature: 0.0, // Zero temperature for maximum consistency
  });

  const aiResponse =
    message.content[0]?.type === "text" ? message.content[0].text : null;

  if (!aiResponse) {
    throw new Error("No response received from Claude");
  }

  console.log("🤖 Raw Claude response received");
  return aiResponse;
};

/**
 * Clean and parse Claude response
 * @param {string} aiResponse - Raw Claude response
 * @returns {Object} Parsed JSON data
 */
const parseClaudeResponse = (aiResponse) => {
  // Clean the response (remove any markdown formatting)
  let cleanedResponse = aiResponse.replace(/```json\n?|\n?```/g, "").trim();

  // Fix common JSON issues before parsing
  // 1. Remove trailing commas before closing braces/brackets
  cleanedResponse = cleanedResponse.replace(/,(\s*[}\]])/g, "$1");

  // 2. Fix numbers with commas (e.g., "1,234" -> "1234")
  cleanedResponse = cleanedResponse.replace(/:\s*"(\d+),(\d+)"/g, ': "$1$2"');

  // 3. Fix unquoted numbers that should be strings
  cleanedResponse = cleanedResponse.replace(
    /:\s*(\d+\.?\d*)\s*([,\n}])/g,
    (match, num, next) => {
      // Keep as number if it's an integer or decimal, quote if it looks like it should be a string
      return `: "${num}"${next}`;
    },
  );

  // Check if response was truncated and try to fix common issues
  if (!cleanedResponse.endsWith("}")) {
    console.warn("⚠️  Response appears truncated, attempting to fix...");
    // Try to close the JSON properly
    const openBraces = (cleanedResponse.match(/{/g) || []).length;
    const closeBraces = (cleanedResponse.match(/}/g) || []).length;
    const missingBraces = openBraces - closeBraces;

    if (missingBraces > 0) {
      cleanedResponse += "}".repeat(missingBraces);
      console.log("🔧 Added missing closing braces");
    }
  }

  try {
    const extractedData = JSON.parse(cleanedResponse);
    return extractedData;
  } catch (parseError) {
    console.error("Failed to parse Claude response as JSON:", parseError);
    console.error("Raw response length:", aiResponse.length);
    console.error("Last 200 characters:", aiResponse.slice(-200));
    console.error("First 500 characters:", aiResponse.slice(0, 500));

    // Log the problematic section around the error position
    if (parseError.message.includes("position")) {
      const position = parseInt(
        parseError.message.match(/position (\d+)/)?.[1] || "0",
      );
      const start = Math.max(0, position - 100);
      const end = Math.min(cleanedResponse.length, position + 100);
      console.error(
        `Context around error (position ${position}):`,
        cleanedResponse.slice(start, end),
      );
    }

    throw new Error(`Invalid JSON response from Claude: ${parseError.message}`);
  }
};

/**
 * Handle Claude API errors
 * @param {Error} error - The error object
 * @throws {Error} Formatted error message
 */
const handleClaudeError = (error) => {
  console.error("🚨 Claude processing failed:", error.message);
  console.error("🔍 Error details:", {
    status: error.status,
    type: error.type,
    message: error.message,
  });

  // Handle specific Claude API errors
  if (error.status === 429) {
    throw new Error(
      "Claude API rate limit exceeded. Please try again in a moment.",
    );
  } else if (error.status === 401) {
    throw new Error(
      "Claude API authentication failed. Please check your API key.",
    );
  } else if (error.status === 400) {
    throw new Error(
      "Invalid request to Claude API. The file might be corrupted or in an unsupported format.",
    );
  } else {
    throw new Error(`Claude processing failed: ${error.message}`);
  }
};

/**
 * Upload file to Claude and extract bulletin data using Vision API
 * @param {string} filePath - Local file path to process
 * @param {string} formType - Form type ('form4' or 'form6')
 * @returns {Promise<Object>} Extracted and translated data
 */
const extractBulletinWithClaude = async (filePath, formType = "form6") => {
  console.log(
    `🔍 Starting Claude Sonnet 4 processing for file: ${filePath} (${formType})`,
  );

  try {
    // Step 1: Prepare file for processing
    const fileData = prepareFileForClaude(filePath);
    console.log(
      `📄 File prepared: ${fileData.filename}, size: ${fileData.fileStats.size} bytes`,
    );

    // Step 2: Call Claude API
    const aiResponse = await callClaudeAPI(fileData, formType);

    // Step 3: Parse response
    const extractedData = parseClaudeResponse(aiResponse);

    console.log(
      "✅ Successfully extracted data with Claude:",
      extractedData.studentName || "Unknown Student",
    );

    // Step 4: Return results
    return {
      success: true,
      data: extractedData,
      metadata: {
        filename: fileData.filename,
        fileSize: fileData.fileStats.size,
        processingTime: new Date().toISOString(),
        model: "claude-sonnet-4-20250514",
        provider: "anthropic",
      },
    };
  } catch (error) {
    handleClaudeError(error);
  }
};

/**
 * Extract a general document using Claude
 * Reuses the generalDocument system/user prompts from openai.js
 * @param {string} filePath - Path to the uploaded file
 * @param {Object} options - Processing options (sourceLanguage, targetLanguage)
 * @returns {Promise<Object>} Extracted and translated data
 */
const extractGeneralDocumentWithClaude = async (filePath, options = {}) => {
  console.log(`🔍 Starting Claude Sonnet 4 general document processing for: ${filePath}`);

  // Import prompt generators from openai.js (shared prompts)
  const { getSystemPrompt, getUserPrompt, processExtractedData } = require("./openai");

  try {
    // Step 1: Prepare file for processing
    const fileData = prepareFileForClaude(filePath);
    const isPDF = fileData.fileExtension === ".pdf";
    console.log(
      `📄 File prepared: ${fileData.filename}, size: ${fileData.fileStats.size} bytes, type: ${isPDF ? "PDF" : "image"}`,
    );

    // Step 2: Get the generalDocument prompts and append Claude-specific exclusion rules
    const baseSystemPrompt = getSystemPrompt("generalDocument", options);
    const systemPrompt = baseSystemPrompt + `

🚫 CONTENT TO EXCLUDE (DO NOT EXTRACT):
- Disclaimer text about signatures, seals, or document validity (e.g., "This document is valid only with official seals and signatures", "Must be presented together with educational credentials", etc.)
- Watermarks or background text that say "COPY", "ORIGINAL", "CERTIFIED", etc.
- Any text that refers to the physical authenticity or legal validity of the ORIGINAL paper document — these do not apply to the translated version`;
    const userPrompt = getUserPrompt("generalDocument", options);

    // Step 3: Call Claude API with the document
    const anthropic = initializeAnthropic();
    console.log(`📤 Processing ${fileData.fileExtension} file with Claude Sonnet 4...`);

    // Build the content block based on file type
    const fileContent = isPDF
      ? {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: fileData.base64File,
          },
        }
      : {
          type: "image",
          source: {
            type: "base64",
            media_type: fileData.mimeType,
            data: fileData.base64File,
          },
        };

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 16000, // Higher limit for multi-page general documents
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            fileContent,
            {
              type: "text",
              text: userPrompt,
            },
          ],
        },
      ],
      temperature: 0.0,
    });

    const aiResponse =
      message.content[0]?.type === "text" ? message.content[0].text : null;

    if (!aiResponse) {
      throw new Error("No response received from Claude");
    }

    console.log("🤖 Raw Claude response received");

    // Step 4: Parse response (reuse existing parser)
    const extractedData = parseClaudeResponse(aiResponse);

    // Step 5: Validate using the shared validation logic
    const { extractedData: processedData, validationResult } =
      processExtractedData(extractedData, "generalDocument");

    console.log(
      "✅ Successfully extracted general document with Claude:",
      processedData.documentTitle || "Unknown Document",
    );

    // Step 6: Return results
    return {
      success: true,
      data: processedData,
      validation: validationResult,
      metadata: {
        filename: fileData.filename,
        fileSize: fileData.fileStats.size,
        processingTime: new Date().toISOString(),
        model: "claude-sonnet-4-20250514",
        provider: "anthropic",
        formType: "generalDocument",
        strictMode: true,
        extractionQuality: validationResult.extractionQuality,
        hasMinimumData: validationResult.hasMinimumData,
      },
    };
  } catch (error) {
    handleClaudeError(error);
  }
};

module.exports = {
  initializeAnthropic,
  extractBulletinWithClaude,
  extractGeneralDocumentWithClaude,
  getClaudeSystemPrompt,
  getClaudeUserPrompt,
  prepareFileForClaude,
  callClaudeAPI,
  parseClaudeResponse,
  handleClaudeError,
};

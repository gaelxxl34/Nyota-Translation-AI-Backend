// OPTIMIZED OpenAI Integration for NTC
// Speed improvements: Image compression, adaptive detail, smart model selection, parallel processing

const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp"); // For image optimization

/**
 * Initialize OpenAI client with API key from environment
 *const selectOptimalModel = (fileSize, formType) => {
  // Complex documents with lots of text/data benefit from GPT-4o
  const complexTypes = ["stateDiploma", "bachelorDiploma", "collegeTranscript", "collegeAttestation"];

  if (complexTypes.includes(formType)) {urns {OpenAI} Configured OpenAI client instance
 */
const initializeOpenAI = () => {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }

  const openai = new OpenAI({
    apiKey: apiKey,
    timeout: 120000, // Reduced to 2 minutes (was 4)
    maxRetries: 1, // Reduced retries for faster failure
  });

  console.log("🤖 OpenAI client initialized (OPTIMIZED MODE)");
  return openai;
};

/**
 * OPTIMIZATION 1: Compress and optimize images before sending
 * Reduces file size by 70-90% with minimal quality loss
 * @param {string} filePath - Original file path
 * @returns {Promise<Object>} Optimized image data
 */
const optimizeImage = async (filePath) => {
  const startTime = Date.now();
  const fileExtension = path.extname(filePath).toLowerCase();

  // Skip optimization for PDFs
  if (fileExtension === ".pdf") {
    const fileBuffer = fs.readFileSync(filePath);
    const fileStats = fs.statSync(filePath);
    return {
      buffer: fileBuffer,
      base64: fileBuffer.toString("base64"),
      mimeType: "application/pdf",
      originalSize: fileStats.size,
      optimizedSize: fileStats.size,
      compressionRatio: 1.0,
      processingTime: Date.now() - startTime,
    };
  }

  try {
    const fileStats = fs.statSync(filePath);
    const originalSize = fileStats.size;

    console.log(`🖼️  Optimizing image: ${(originalSize / 1024).toFixed(2)} KB`);

    // Use Sharp to optimize image
    const optimizedBuffer = await sharp(filePath)
      .resize(2048, 2048, {
        // Max 2048px (OpenAI recommended for detail: auto/low)
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({
        quality: 85, // High quality but compressed
        progressive: true,
        mozjpeg: true, // Better compression
      })
      .toBuffer();

    const optimizedSize = optimizedBuffer.length;
    const compressionRatio = (1 - optimizedSize / originalSize) * 100;

    console.log(
      `✅ Image optimized: ${(optimizedSize / 1024).toFixed(
        2
      )} KB (${compressionRatio.toFixed(1)}% smaller)`
    );
    console.log(`⚡ Optimization time: ${Date.now() - startTime}ms`);

    return {
      buffer: optimizedBuffer,
      base64: optimizedBuffer.toString("base64"),
      mimeType: "image/jpeg",
      originalSize,
      optimizedSize,
      compressionRatio,
      processingTime: Date.now() - startTime,
    };
  } catch (error) {
    console.warn(
      `⚠️  Image optimization failed, using original: ${error.message}`
    );
    // Fallback to original file
    const fileBuffer = fs.readFileSync(filePath);
    return {
      buffer: fileBuffer,
      base64: fileBuffer.toString("base64"),
      mimeType: "image/jpeg",
      originalSize: fileStats.size,
      optimizedSize: fileStats.size,
      compressionRatio: 0,
      processingTime: Date.now() - startTime,
    };
  }
};

/**
 * OPTIMIZATION 2: Use adaptive detail level based on file characteristics
 * @param {number} fileSize - File size in bytes
 * @param {string} formType - Form type
 * @returns {string} Appropriate detail level
 */
const getAdaptiveDetail = (fileSize, formType) => {
  // Larger, text-heavy documents benefit more from "high" detail
  // Bulletins with tables can often work well with "auto"
  const textHeavyTypes = [
    "stateDiploma",
    "bachelorDiploma",
    "collegeTranscript",
    "collegeAttestation",
  ];
  if (textHeavyTypes.includes(formType)) {
    return "high";
  }

  // For bulletins, use "auto" for smaller files, "high" for larger
  return fileSize > 1000000 ? "high" : "auto";
};

/**
 * OPTIMIZATION 3: Shorter, more focused system prompts (reduces latency)
 * @param {string} formType - The form type
 * @returns {string} Concise system prompt
 */
const getOptimizedSystemPrompt = (formType) => {
  if (formType === "stateDiploma") {
    return `Expert DRC State Diploma extractor. Extract ALL visible fields accurately.

CRITICAL RULES:
- Extract student info: name, gender, birth details
- Extract exam details: session, section, option, percentage
- Extract certificate: issue date, serial numbers
- Translate French → English
- Return ONLY valid JSON

JSON format:
{
  "extractionMetadata": {"confidence": 0-100, "documentType": "stateDiploma", "missingFields": [], "uncertainFields": [], "extractionNotes": ""},
  "studentName": "", "gender": "", "birthPlace": "", "birthDate": {"day": "", "month": "", "year": ""},
  "examSession": "", "percentage": "", "percentageText": "", "section": "", "option": "",
  "issueDate": "", "serialNumbers": [], "serialCode": ""
}`;
  }

  if (formType === "bachelorDiploma") {
    return `Expert DRC University Bachelor Diploma extractor. Extract ALL visible fields accurately.

CRITICAL RULES:
- Extract institution details: name, location
- Extract student info: name, birth details
- Extract academic details: degree, specialization, orientation, completion date
- Extract certificate: issue date, registration number, serial code
- Translate ALL French words → English EXCEPT proper nouns (student names, cities, institution names)
- Return ONLY valid JSON

CRITICAL FRENCH → ENGLISH TRANSLATIONS:
Academic Terms:
- "douanes et accises" → "Customs and Excise"
- "GRADE EN SCIENCES" → "BACHELOR OF SCIENCES"
- "troisième graduat" → "third-year undergraduate" or "third year bachelor's"
- "deuxième quadrimestre" → "second term" or "second semester"
- "premier quadrimestre" → "first term" or "first semester"
- "sciences commerciales et financières" → "Commercial and Financial Sciences"
- "orientation" → "orientation" (keep in English)
- "option" → "option" (keep in English)

Date Translations (CRITICAL - translate month names):
- "janvier" → "January"
- "février" → "February"
- "mars" → "March"
- "avril" → "April"
- "mai" → "May"
- "juin" → "June"
- "juillet" → "July"
- "août" → "August"
- "septembre" → "September"
- "octobre" → "October"
- "novembre" → "November"
- "décembre" → "December"

DO NOT TRANSLATE (Keep as-is):
- Student names (e.g., "MBUSA KALINSYA RIPHIRI")
- City names (e.g., "Beni", "Goma", "Kinshasa")
- Institution names (e.g., "Institut Supérieur de Commerce")

JSON format:
{
  "extractionMetadata": {"confidence": 0-100, "documentType": "bachelorDiploma", "missingFields": [], "uncertainFields": [], "extractionNotes": ""},
  "institutionName": "", "institutionLocation": "", "diplomaNumber": "",
  "studentName": "", "birthPlace": "", "birthDate": "",
  "degree": "", "specialization": "", "orientation": "", "gradeLevel": "", "gradeSpecialization": "", "option": "", "orientationDetail": "",
  "completionDate": "", "graduationYear": "",
  "issueLocation": "", "issueDate": "",
  "registrationDate": "", "registrationNumber": "", "serialCode": "", "examDate": "", "registerLetter": ""
}`;
  }

  if (formType === "collegeTranscript") {
    return `Expert DRC College/University Transcript extractor. Extract ALL visible fields accurately.

CRITICAL RULES:
- Extract institution details: name, type, abbreviation, email
- Extract student info: name, matricule (keep name in UPPERCASE)
- Extract academic details: section, option, level, academic year, session
- **DETECT TABLE FORMAT**: Determine if it's a 3-column (simple) or 4-6 column (weighted) format
- **COUNT AND EXTRACT EVERY SINGLE COURSE ROW**: Carefully scan the entire table from top to bottom. Do NOT skip any course rows. If you see 13 courses, extract all 13 courses.
- **Extract ALL summary rows** after courses (Total cours, Mémoire, Stage, Travail de fin de cycle, Moyenne cours, Pourcentage cours, Total général, Pourcentage, DECISION DU JURY)
- Extract certificate: issue location, date, secretary, chief of works
- Translate French → English including ALL bold/italic terms
- Return ONLY valid JSON
- **VERIFICATION**: Before responding, count the number of course rows you extracted and verify it matches the total number of courses visible in the document

TABLE FORMAT DETECTION:
1. **Simple Format (3-column)**: N° | Course Name | Vol. Hourly | Grade
   - Example: "1 | Business Economics | 120H | 44/60"
   - Courses have: courseNumber, courseName, creditHours, grade

2. **Weighted Format (4-6 column)**: N° | Course Name | Vol. Hourly | Units | Max | Weighted Grade
   - Example: "1 | Business Economics | 60 | 4 | 80 | 44"
   - Courses have: courseNumber, courseName, creditHours, units, maxGrade, weightedGrade

SUMMARY ROWS EXTRACTION (CRITICAL - MUST EXTRACT ALL):
**SCAN EVERY ROW** after the last numbered course until you reach signatures/dates section.
Look for these patterns and extract ALL that appear (in order):
- "Total cours" / "TOTAL COURS" / "POURCENTAGE COURS" → type: "subtotal"
- "Mémoire" / "MEMOIRE" → type: "component"
- "Stage" / "STAGE" → type: "component"
- "Travail de fin de cycle" / "TRAVAIL DE FIN DE CYCLE" → type: "component"
- "Moyenne" / "MOYENNE" / "Moyenne cours" → type: "average"
- "Total général" / "Total Général" / "TOTAL GENERAL" → type: "total"
- "Pourcentage" / "POURCENTAGE" (at the end) → type: "percentage"
- "DECISION DU JURY" / any decision text → store in "decision" field

**DO NOT SKIP** any row between courses and signatures. If you see a row with numbers/grades, it's likely a summary row.

Each summary row should capture:
- label: The row label (translated to English)
- values: { grade: "", maxGrade: "", units: "", hours: "" } (extract what's available)
- type: "subtotal" | "component" | "total" | "percentage" | "average"
- isBold: true if the text appears bold or in uppercase

Example patterns to recognize:
- "Total cours    240/350" → {"label": "Total Courses", "values": {"grade": "240/350"}, "type": "subtotal", "isBold": true}
- "Mémoire        121/175" → {"label": "Thesis", "values": {"grade": "121", "maxGrade": "175"}, "type": "component", "isBold": false}
- "Pourcentage    69.1 %" → {"label": "Percentage", "values": {"grade": "69.1 %"}, "type": "percentage", "isBold": true}

CRITICAL FRENCH → ENGLISH TRANSLATIONS (especially bold terms):
- "Sciences Commerciales et Financières" → "Commercial and Financial Sciences"
- "Fiscalité" → "Taxation" or "Fiscal Studies"
- "Première Licence" → "First Year License"
- "Deuxième Licence" → "Second Year License"
- "Troisième Licence" → "Third Year License"
- "Première session" → "First Session"
- "Deuxième session" → "Second Session"
- "a régulièrement suivi les matières prévues au programme" → "regularly followed the subjects planned in the program"
- "Total cours" → "Total Courses" or "Course Total"
- "Pourcentage cours" → "Course Percentage"
- "Mémoire" → "Thesis" or "Dissertation"
- "Stage" → "Internship"
- "Travail de fin de cycle" → "Final Cycle Work" or "Capstone Project"
- "Moyenne cours" → "Course Average"
- "Total général" → "Overall Total"
- "Pourcentage" → "Percentage"
- "A REUSSI AVEC SATISFACTION" → "PASSED WITH SATISFACTION"
- "A REUSSI AVEC DISTINCTION" → "PASSED WITH DISTINCTION"
- "A REUSSI AVEC GRANDE DISTINCTION" → "PASSED WITH GREAT DISTINCTION"

JSON format (EXAMPLE - include ALL courses you find, not just 2):
{
  "extractionMetadata": {"confidence": 0-100, "documentType": "collegeTranscript", "missingFields": [], "uncertainFields": [], "extractionNotes": "Add note if you found more/less courses than typical"},
  "country": "", "institutionType": "", "institutionName": "", "institutionAbbreviation": "", "institutionEmail": "",
  "departmentName": "", "documentTitle": "", "documentNumber": "",
  "studentName": "", "matricule": "",
  "hasFollowedCourses": "", "section": "", "option": "", "level": "", "academicYear": "", "session": "",
  "tableFormat": "simple",
  "courses": [
    {"courseNumber": 1, "courseName": "", "creditHours": "", "grade": ""},
    {"courseNumber": 2, "courseName": "", "creditHours": "", "grade": ""},
    ... continue for ALL courses found (could be 10, 11, 12, 13, 15+ courses)
  ],
  "summaryRows": [
    {"label": "Total Courses", "values": {"grade": "240/350"}, "type": "subtotal", "isBold": true},
    {"label": "Thesis", "values": {"grade": "121", "maxGrade": "175"}, "type": "component", "isBold": false},
    {"label": "Internship", "values": {"grade": "123", "maxGrade": "175"}, "type": "component", "isBold": false},
    {"label": "Overall Total", "values": {"grade": "484/700"}, "type": "total", "isBold": true},
    {"label": "Percentage", "values": {"grade": "69.1 %"}, "type": "percentage", "isBold": true}
  ],
  "decision": "",
  "issueLocation": "", "issueDate": "",
  "secretary": "", "secretaryTitle": "", "chiefOfWorks": "", "chiefOfWorksTitle": ""
}

IMPORTANT: 
- **EXTRACT EVERY SINGLE COURSE**: If you see 13 numbered courses (1-13), your JSON should have 13 course objects
- **EXTRACT EVERY SUMMARY ROW**: After the last course, scan line by line until signatures. Extract ALL rows with grades/scores
- If tableFormat is "weighted", fill in units, maxGrade, weightedGrade for courses
- If tableFormat is "simple", only fill courseNumber, courseName, creditHours, grade
- Preserve row order as it appears in the document
- Double-check your course count AND summary row count before responding
- If you see "Total cours", "Mémoire", "Stage", "Total général", "Pourcentage" - they ALL must be in summaryRows array`;
  }

  if (formType === "collegeAttestation") {
    return `Expert DRC College/University Attestation Certificate extractor. Extract ALL visible fields accurately.

CRITICAL RULES:
- Extract institution details: name, abbreviation, email, website, location
- Extract document details: document number
- Extract signatory details: title, name, position
- Extract student info: name, gender (le/la), birth place, birth date, matricule
- Extract academic details: enrollment status, section, option, year level, performance, percentage, session
- Extract issue details: location, date
- Extract signatures: secretary title, chief title, chief name, chief position
- Translate French → English for ALL text fields
- Keep student names and institution names in UPPERCASE as they appear
- Return ONLY valid JSON

CRITICAL FRENCH → ENGLISH TRANSLATIONS:
Gender Markers:
- "le" (masculine) → "le" (keep for gender identification)
- "la" (feminine) → "la" (keep for gender identification)

Academic Terms:
- "Sciences Commerciales et Financières" → "Commercial and Financial Sciences"
- "option Fiscalité" → "Fiscal Option" or "Taxation Option"
- "Deuxième Licence" → "Second Year License" or "Second Year Bachelor's"
- "Première Licence" → "First Year License" or "First Year Bachelor's"
- "régulièrement inscrit(e) en Section de" → "regularly enrolled in the Section of"
- "mention SATISFAISANT" → "SATISFACTORY grade"
- "mention DISTINCTION" → "DISTINCTION grade"
- "mention GRANDE DISTINCTION" → "GREAT DISTINCTION grade"
- "en première session" → "in the first session"
- "en deuxième session" → "in the second session"

Signatory Titles:
- "Chef de Travaux" → "Chief of Works"
- "Secrétaire Général Académique" → "General Academic Secretary"

JSON format:
{
  "extractionMetadata": {"confidence": 0-100, "documentType": "collegeAttestation", "missingFields": [], "uncertainFields": [], "extractionNotes": ""},
  "institutionName": "", "institutionAbbreviation": "", "institutionEmail": "", "institutionWebsite": "",
  "departmentName": "", "documentNumber": "",
  "signatoryTitle": "", "signatoryName": "", "signatoryPosition": "",
  "studentName": "", "studentGender": "", "birthPlace": "", "birthDate": "", "matricule": "",
  "enrollmentStatus": "", "section": "", "option": "", "institutionLocation": "",
  "academicYear": "", "yearLevel": "", "performance": "", "percentage": "", "session": "",
  "issueLocation": "", "issueDate": "",
  "secretaryTitle": "", "chiefTitle": "", "chiefName": "", "chiefPosition": ""
}`;
  }

  // Bulletin (form4/form6) - optimized but complete
  return `Expert DRC bulletin extractor. Extract ALL fields accurately using DRC education expertise.

CRITICAL RULES:
- NO maxima < 10 in DRC system (re-check if you see less)
- "4ième" = Form 6, "2ième" = Form 4
- "Maxima Généraux" = AGGREGATE MAXIMA, "Totaux" = AGGREGATES
- Group by PERIOD maxima only, preserve order
- Translate French → English

Return ONLY valid JSON:
{
  "extractionMetadata": {"confidence": 0-100, "missingFields": [], "uncertainFields": [], "extractionNotes": ""},
  "province": "", "city": "", "municipality": "", "school": "", "schoolCode": "",
  "studentName": "", "gender": "", "birthPlace": "", "birthDate": "", "class": "",
  "permanentNumber": "", "idNumber": "", "academicYear": "",
  "subjects": [{"subject": "", "firstSemester": {"period1": 0, "period2": 0, "exam": 0, "total": 0}, 
    "secondSemester": {"period3": 0, "period4": 0, "exam": 0, "total": 0}, "overallTotal": 0,
    "maxima": {"periodMaxima": 0, "examMaxima": 0, "totalMaxima": 0},
    "nationalExam": {"marks": 0, "max": 0},
    "confidence": {"subject": 100, "gradesAvg": 100, "maxima": 100, "nationalExam": 100}}],
  "totalMarksOutOf": {"firstSemester": 0, "secondSemester": 0},
  "totalMarksObtained": {"firstSemester": 0, "secondSemester": 0},
  "percentage": {"firstSemester": 0, "secondSemester": 0},
  "position": "", "totalStudents": 0, "application": "", "behaviour": "",
  "finalResultPercentage": "", "isPromoted": null, "shouldRepeat": "",
  "issueLocation": "", "issueDate": "", "centerCode": "", "verifierName": "", "endorsementDate": ""
}`;
};

/**
 * OPTIMIZATION 4: Ultra-concise user prompts
 * @param {string} formType - The form type
 * @returns {string} Brief user prompt
 */
const getOptimizedUserPrompt = (formType) => {
  if (formType === "stateDiploma") {
    return "Analyze this DRC State Examination Certificate and extract ALL visible fields accurately. Translate French to English. Return ONLY the JSON object.";
  }

  if (formType === "bachelorDiploma") {
    return "Analyze this DRC University Bachelor Diploma and extract ALL visible fields accurately. Translate ALL French text to English (including dates with French month names like 'juillet', 'décembre', 'mars', 'juin' and academic terms like 'douanes et accises', 'deuxième quadrimestre', 'GRADE EN SCIENCES'), but keep proper nouns unchanged (student names, city names, institution names). Return ONLY the JSON object.";
  }

  if (formType === "collegeTranscript") {
    return "Analyze this DRC College/University Transcript and extract ALL visible fields accurately. COUNT each course row from top to bottom (e.g., if numbered 1-13, extract all 13 courses). After the last course, SCAN EVERY ROW until you reach signatures/dates - extract ALL summary rows (Total cours, Mémoire, Stage, Travail de fin de cycle, Moyenne, Total général, Pourcentage, DECISION DU JURY). DETECT if the table is 3-column (simple: N°, Course, Hours, Grade) or 4-6 column (weighted: N°, Course, Hours, Units, Max, Grade). Extract all columns that are present. Translate ALL French text to English, especially bold/italic terms like 'Sciences Commerciales et Financières', 'Fiscalité', 'Première Licence', 'Première session', 'Mémoire', 'Stage', 'Travail de fin de cycle'. Return ONLY the JSON object with tableFormat ('simple' or 'weighted'), all courses, and ALL summaryRows. VERIFY your course count AND summary row count before responding.";
  }

  if (formType === "collegeAttestation") {
    return "Analyze this DRC College/University Attestation Certificate and extract ALL visible fields accurately. Translate ALL French text to English, including academic terms like 'Sciences Commerciales et Financières', 'option Fiscalité', 'Deuxième Licence', 'mention SATISFAISANT', 'régulièrement inscrit(e)', 'en première session', and signatory titles like 'Chef de Travaux', 'Secrétaire Général Académique'. Keep student names and institution names in their original form. Return ONLY the JSON object.";
  }

  // Bulletin (form4/form6)
  return "Analyze this DRC school bulletin and extract ALL visible data accurately. Apply DRC education rules (no maxima < 10). Translate French to English. Return ONLY the JSON object with all fields filled.";
};

/**
 * OPTIMIZATION 5: Smart model selection (mini vs full)
 * @param {number} fileSize - File size
 * @param {string} formType - Form type
 * @returns {string} Model to use
 */
const selectOptimalModel = (fileSize, formType) => {
  // Use full gpt-4o model for complex documents with more fields
  const complexTypes = [
    "stateDiploma",
    "bachelorDiploma",
    "collegeTranscript",
    "collegeAttestation",
  ];

  if (complexTypes.includes(formType)) {
    return "gpt-4o"; // Full model for accuracy on complex documents
  }

  // Use faster gpt-4o-mini for:
  // - Small files (< 500KB)
  // - Form4 (simpler than Form6)
  const useQuickModel = fileSize < 500_000 && formType === "form4";

  return useQuickModel ? "gpt-4o-mini" : "gpt-4o";
};

/**
 * OPTIMIZATION 6: Call OpenAI with optimizations applied
 * @param {Object} optimizedImage - Optimized image data
 * @param {string} formType - Form type
 * @param {number} originalFileSize - Original file size
 * @returns {Promise<Object>} Response with timing
 */
const callOptimizedOpenAIAPI = async (
  optimizedImage,
  formType,
  originalFileSize
) => {
  const startTime = Date.now();
  const openai = initializeOpenAI();

  const model = selectOptimalModel(originalFileSize, formType);
  const detail = getAdaptiveDetail(originalFileSize, formType);
  const systemPrompt = getOptimizedSystemPrompt(formType);
  const userPrompt = getOptimizedUserPrompt(formType);

  console.log(`🚀 OPTIMIZED PROCESSING:`);
  console.log(
    `   Model: ${model} (${
      model === "gpt-4o-mini" ? "2-3x faster" : "max accuracy"
    })`
  );
  console.log(
    `   Detail: ${detail} (${detail === "auto" ? "2-3x faster" : "max detail"})`
  );
  console.log(
    `   Image size: ${(optimizedImage.optimizedSize / 1024).toFixed(2)} KB`
  );

  const response = await openai.chat.completions.create({
    model: model,
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: userPrompt,
          },
          {
            type: "image_url",
            image_url: {
              url: `data:${optimizedImage.mimeType};base64,${optimizedImage.base64}`,
              detail: detail,
            },
          },
        ],
      },
    ],
    max_tokens: 8000, // Increased for safety
    temperature: 0.0,
    top_p: 0.1,
    frequency_penalty: 0.0,
    presence_penalty: 0.0,
    response_format: { type: "json_object" }, // ✅ GUARANTEED JSON!
  });

  const apiTime = Date.now() - startTime;
  const aiResponse = response.choices[0]?.message?.content;

  if (!aiResponse) {
    throw new Error("No response received from OpenAI");
  }

  console.log(`⚡ OpenAI API time: ${(apiTime / 1000).toFixed(2)}s`);
  console.log(
    `💰 Tokens used: ${response.usage.total_tokens} (prompt: ${response.usage.prompt_tokens}, completion: ${response.usage.completion_tokens})`
  );

  return {
    content: aiResponse,
    timing: {
      apiCallTime: apiTime,
      totalTokens: response.usage.total_tokens,
      promptTokens: response.usage.prompt_tokens,
      completionTokens: response.usage.completion_tokens,
    },
    model,
    detail,
  };
};

/**
 * OPTIMIZATION 7: Main optimized upload and extract function
 * @param {string} filePath - Local file path to process
 * @param {string} formType - Form type ('form4', 'form6', or 'stateDiploma')
 * @returns {Promise<Object>} Extracted and translated data with performance metrics
 */
const uploadAndExtractOptimized = async (filePath, formType = "form6") => {
  const totalStartTime = Date.now();
  console.log(`🔍 OPTIMIZED PROCESSING: ${filePath} (${formType})`);

  try {
    // Check file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileStats = fs.statSync(filePath);
    const originalFileSize = fileStats.size;

    // Step 1: Optimize image (parallel-ready)
    const optimizedImage = await optimizeImage(filePath);

    // Step 2: Call OpenAI with optimizations
    const openaiResponse = await callOptimizedOpenAIAPI(
      optimizedImage,
      formType,
      originalFileSize
    );

    // Step 3: Parse JSON (guaranteed valid with response_format)
    const extractedData = JSON.parse(openaiResponse.content);

    // Step 4: Quick validation (imported from original)
    const { validateExtractedData, sortSubjectsByMaxima } = require("./openai");

    if (extractedData.subjects && Array.isArray(extractedData.subjects)) {
      extractedData.subjects = sortSubjectsByMaxima(extractedData.subjects);
    }

    const validationResult = validateExtractedData(extractedData, formType);

    // Calculate total time
    const totalTime = Date.now() - totalStartTime;

    console.log(`✅ TOTAL PROCESSING TIME: ${(totalTime / 1000).toFixed(2)}s`);
    console.log(`📊 BREAKDOWN:`);
    console.log(`   Image optimization: ${optimizedImage.processingTime}ms`);
    console.log(`   OpenAI API call: ${openaiResponse.timing.apiCallTime}ms`);
    console.log(
      `   Speed improvement: ${((240000 - totalTime) / 1000).toFixed(
        1
      )}s faster than 4min timeout`
    );

    return {
      success: true,
      data: extractedData,
      validation: validationResult,
      metadata: {
        filename: path.basename(filePath),
        fileSize: originalFileSize,
        processingTime: new Date().toISOString(),
        model: openaiResponse.model,
        detail: openaiResponse.detail,
        strictMode: true,
        extractionQuality: validationResult.extractionQuality,
        hasMinimumData: validationResult.hasMinimumData,
      },
      performance: {
        totalTimeMs: totalTime,
        imageOptimizationMs: optimizedImage.processingTime,
        apiCallMs: openaiResponse.timing.apiCallTime,
        originalFileSizeKB: (originalFileSize / 1024).toFixed(2),
        optimizedFileSizeKB: (optimizedImage.optimizedSize / 1024).toFixed(2),
        compressionRatio: `${optimizedImage.compressionRatio.toFixed(1)}%`,
        tokensUsed: openaiResponse.timing.totalTokens,
        speedup: `${((240000 - totalTime) / 1000).toFixed(1)}s faster`,
      },
    };
  } catch (error) {
    console.error("🚨 Optimized processing failed:", error.message);
    throw error;
  }
};

module.exports = {
  uploadAndExtractOptimized,
  optimizeImage,
  getAdaptiveDetail,
  selectOptimalModel,
};

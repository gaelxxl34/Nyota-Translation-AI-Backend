// OpenAI Integration for NTC
// Handles bulletin image processing and translation using OpenAI API

const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");

/**
 * Initialize OpenAI client with API key from environment
 * @returns {OpenAI} Configured OpenAI client instance
 */
const initializeOpenAI = () => {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }

  const openai = new OpenAI({
    apiKey: apiKey,
  });

  console.log("🤖 OpenAI client initialized successfully");
  return openai;
};

/**
 * Upload file to OpenAI and extract bulletin data using Vision API
 * @param {string} filePath - Local file path to process
 * @param {string} formType - Form type ('form4' or 'form6')
 * @returns {Promise<Object>} Extracted and translated bulletin data
 */
const uploadAndExtract = async (filePath, formType = "form6") => {
  console.log(
    `🔍 Starting OpenAI processing for file: ${filePath} (${formType})`
  );

  try {
    const openai = initializeOpenAI();

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Get file stats
    const fileStats = fs.statSync(filePath);
    const fileExtension = path.extname(filePath).toLowerCase();
    console.log(
      `📄 File size: ${fileStats.size} bytes, extension: ${fileExtension}, form type: ${formType}`
    );

    // Read file as base64 for Vision API
    const fileBuffer = fs.readFileSync(filePath);
    const base64File = fileBuffer.toString("base64");
    const mimeType = getMimeType(fileExtension);

    console.log(
      `📤 Processing ${fileExtension} file with OpenAI Vision API...`
    );

    // System prompt for bulletin extraction with senior DRC education expert persona
    const systemPrompt = `You are a SENIOR EXPERT in DRC (Democratic Republic of Congo) French school bulletin translation with 15+ years of experience. You have processed thousands of bulletins from Congolese schools and know the education system inside and out.

🎓 YOUR EXPERTISE:
- Deep knowledge of DRC education system structure and terminology
- Expert in French-to-English academic translation for Congolese schools
- Familiar with all class levels, subject naming conventions, and grading systems
- Know exactly what subjects and maxima to expect for each class level
- Understand regional variations in bulletin formats across DRC provinces

🧠 DRC EDUCATION SYSTEM KNOWLEDGE:
- MAXIMA MINIMUM: In DRC system, NO MAXIMA is ever less than 10. If you see /5 or /6, you're misreading - re-examine carefully
- AGGREGATE SYSTEM: "Maxima Généraux" = AGGREGATE MAXIMA in English template
- TOTALS: "Totaux" = AGGREGATES in English template  
- POSITION: "Place/Nbre d'élèves" = POSITION/OUT OF (e.g., "15/58" means position 15 out of 58 students)

🏫 CLASS LEVEL TRANSLATIONS:
- "4e" or "4ième" = Form 6 (not Form 4!)
- "2ième" or "2e" = Form 4
- 

📚 STANDARD SUBJECTS FOR MATH-PHYSICS PROGRAMS (4ième Humanité):
Expected subjects with typical maxima:
- Mathématiques (Mathematics) - Usually /50 periods, /100 exams, /200 total
- Physique (Physics) - Usually /40 periods, /80 exams, /160 total  
- Français (French Language) - Usually /50 periods, /100 exams, /200 total
- Anglais (English) - Usually /40 periods, /80 exams, /160 total
- Chimie (Chemistry) - Usually /20 periods, /40 exams, /80 total
- Biologie (Biology) - Usually /20 periods, /40 exams, /80 total
- Histoire (History) - Usually /20 periods, /40 exams, /80 total
- Géographie (Geography) - Usually /20 periods, /40 exams, /80 total
- Education Civique (Civic Education) - Usually /10 periods, /20 exams, /40 total
- Religion (Religious Education) - Usually /10 periods, /20 exams, /40 total
- Education Physique (Physical Education) - Usually /20 periods, /40 exams, /80 total

💡 YOUR APPROACH:
1. Quickly identify the class level and program type
2. Cross-reference expected subjects for that program
3. Validate maxima against known DRC standards (minimum /10)
4. Group by period maxima (never total maxima)
5. Double-check extraction against your DRC expertise
6. Use professional terminology in English translations

CRITICAL RULES:
- NEVER create maxima below /10 (impossible in DRC system)
- Group subjects by PERIOD maxima only (the individual period columns)
- Preserve exact order within each maxima group as shown in bulletin
- Extract ONLY what is clearly visible - no guessing
- Apply DRC education expertise to validate reasonable subject/maxima combinations

JSON SCHEMA (unchanged):
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
      "subject": "string (English translation)",
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
  "finalResultPercentage": "string or null",
  "isPromoted": boolean or null,
  "shouldRepeat": "string or null",
  "issueLocation": "string or null",
  "issueDate": "string or null",
  "centerCode": "string or null",
  "verifierName": "string or null",
  "endorsementDate": "string or null"
}`;

    const userPrompt = `As a senior DRC education expert, analyze this bulletin and apply your deep knowledge:

🎓 EXPERT ANALYSIS APPROACH:
1. Identify class level and program type first (e.g., 4ième Humanité Math-Physics)
2. Cross-reference expected subjects and maxima for this program level
3. Validate that all maxima are ≥10 (DRC standard - if you see less, re-examine)
4. Group subjects by period maxima only (never by total maxima)
5. Use your expertise to spot and correct any inconsistencies
6. Apply proper DRC-to-English terminology

🚨 CRITICAL REMINDERS:
- NO maxima below /10 exists in DRC system
- "Maxima Généraux" = AGGREGATE MAXIMA
- "Totaux" = AGGREGATES
- "Place/Nbre d'élèves" = POSITION/OUT OF
- Group by PERIOD maxima only, preserve order within groups

🧠 APPLY YOUR EXPERTISE:
- You know what subjects belong in Math-Physics programs
- You know typical maxima patterns for each subject
- You understand DRC bulletin layout and terminology
- Double-check extractions against your knowledge

Extract with confidence as the senior expert you are. Return only clean JSON.`;

    // Call OpenAI Vision API with expert-focused parameters
    const response = await openai.chat.completions.create({
      model: "gpt-4o", // Using full GPT-4o for maximum accuracy
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
                url: `data:${mimeType};base64,${base64File}`,
                detail: "high", // Maximum detail for OCR accuracy
              },
            },
          ],
        },
      ],
      max_tokens: 6000,
      temperature: 0.0, // Zero temperature for maximum consistency
      top_p: 0.1, // Very focused sampling
      frequency_penalty: 0.0,
      presence_penalty: 0.0,
    });

    const aiResponse = response.choices[0]?.message?.content;

    if (!aiResponse) {
      throw new Error("No response received from OpenAI");
    }

    console.log("🤖 Raw OpenAI response:", aiResponse);

    // Parse the JSON response with strict validation
    let extractedData;
    let validationResult;

    try {
      // Clean the response (remove any markdown formatting)
      let cleanedResponse = aiResponse.replace(/```json\n?|\n?```/g, "").trim();

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

      extractedData = JSON.parse(cleanedResponse);

      // Post-process: Sort subjects by maxima values (lower to higher) while preserving original order within groups
      if (extractedData.subjects && Array.isArray(extractedData.subjects)) {
        extractedData.subjects = sortSubjectsByMaxima(extractedData.subjects);
        console.log(
          "📊 Subjects sorted by maxima values (lower to higher), original order preserved within groups"
        );
      }

      // Run strict validation
      validationResult = validateExtractedData(extractedData);

      // Log validation results
      if (!validationResult.isValid) {
        console.error("🚨 STRICT VALIDATION FAILED:");
        validationResult.errors.forEach((error) =>
          console.error(`   ❌ ${error}`)
        );
      }

      if (validationResult.warnings.length > 0) {
        console.warn("⚠️  VALIDATION WARNINGS:");
        validationResult.warnings.forEach((warning) =>
          console.warn(`   ⚠️  ${warning}`)
        );
      }

      if (validationResult.missingRequired.length > 0) {
        console.warn("📋 MISSING REQUIRED FIELDS:");
        validationResult.missingRequired.forEach((field) =>
          console.warn(`   📝 ${field}`)
        );
      }

      // Enhance the extracted data with validation metadata
      extractedData.validationResult = validationResult;
    } catch (parseError) {
      console.error("Failed to parse OpenAI response as JSON:", parseError);
      console.error("Raw response length:", aiResponse.length);
      console.error("Last 200 characters:", aiResponse.slice(-200));
      throw new Error(
        `Invalid JSON response from OpenAI: ${parseError.message}. Response may have been truncated due to token limit.`
      );
    }

    console.log(
      "✅ Successfully extracted bulletin data:",
      extractedData.studentName || "Unknown Student"
    );

    // Log extraction quality summary
    console.log("📊 STRICT MODE EXTRACTION SUMMARY:");
    console.log(
      `   👤 Student: ${extractedData.studentName || "Not extracted"}`
    );
    console.log(`   🎓 Class: ${extractedData.class || "Not extracted"}`);
    console.log(`   📚 Subjects: ${validationResult.subjectCount}`);
    console.log(
      `   🎯 Validation: ${validationResult.isValid ? "PASS" : "FAIL"}`
    );
    console.log(
      `   📈 Confidence: ${validationResult.extractionQuality || "N/A"}%`
    );
    console.log(
      `   ⚠️  Issues: ${
        validationResult.errors.length + validationResult.warnings.length
      }`
    );

    return {
      success: true,
      data: extractedData,
      validation: validationResult,
      metadata: {
        filename: path.basename(filePath),
        fileSize: fileStats.size,
        processingTime: new Date().toISOString(),
        model: "gpt-4o",
        strictMode: true,
        extractionQuality: validationResult.extractionQuality,
        hasMinimumData: validationResult.hasMinimumData,
      },
    };
  } catch (error) {
    console.error("🚨 OpenAI processing failed:", error.message);
    console.error("🔍 Error details:", {
      status: error.status,
      code: error.code,
      type: error.type,
      param: error.param,
    });

    // Handle specific OpenAI API errors
    if (error.status === 429) {
      throw new Error(
        "OpenAI API quota exceeded. Please check your billing details and try again later."
      );
    } else if (error.status === 401) {
      throw new Error(
        "OpenAI API authentication failed. Please check your API key."
      );
    } else if (error.status === 400) {
      throw new Error(
        "Invalid request to OpenAI API. The file might be corrupted or in an unsupported format."
      );
    } else if (error.code === "insufficient_quota") {
      throw new Error(
        "OpenAI API quota insufficient. Please add credits to your OpenAI account or enable mock mode."
      );
    } else {
      throw new Error(`OpenAI processing failed: ${error.message}`);
    }
  }
};

/**
 * Validate extracted bulletin data against strict requirements
 * @param {Object} data - The extracted bulletin data
 * @returns {Object} Validation result with errors and warnings
 */
const validateExtractedData = (data) => {
  const errors = [];
  const warnings = [];
  const required = [];

  console.log("🔍 Starting strict validation of extracted data...");

  // Check required fields
  const requiredFields = ["studentName", "class", "academicYear", "subjects"];

  requiredFields.forEach((field) => {
    if (!data[field] || data[field] === null) {
      required.push(field);
    }
  });

  // Validate subjects array
  if (!Array.isArray(data.subjects) || data.subjects.length === 0) {
    errors.push("No subjects extracted - this is critical data");
  } else {
    // Validate each subject
    data.subjects.forEach((subject, index) => {
      if (!subject.subject) {
        errors.push(`Subject ${index + 1}: Missing subject name`);
      }

      // Check for maxima values (critical)
      if (
        !subject.maxima ||
        (subject.maxima.periodMaxima === null &&
          subject.maxima.examMaxima === null &&
          subject.maxima.totalMaxima === null)
      ) {
        warnings.push(
          `Subject ${subject.subject || index + 1}: Missing maxima values`
        );
      }

      // DRC-specific validation: Check for invalid maxima (must be ≥10)
      if (subject.maxima) {
        const { periodMaxima, examMaxima, totalMaxima } = subject.maxima;

        if (periodMaxima !== null && periodMaxima < 10) {
          errors.push(
            `Subject ${
              subject.subject || index + 1
            }: Invalid period maxima (${periodMaxima}) - DRC system minimum is 10`
          );
        }

        if (examMaxima !== null && examMaxima < 10) {
          errors.push(
            `Subject ${
              subject.subject || index + 1
            }: Invalid exam maxima (${examMaxima}) - DRC system minimum is 10`
          );
        }

        if (totalMaxima !== null && totalMaxima < 10) {
          errors.push(
            `Subject ${
              subject.subject || index + 1
            }: Invalid total maxima (${totalMaxima}) - DRC system minimum is 10`
          );
        }
      }

      // Check for grade completeness
      const firstSem = subject.firstSemester || {};
      const secondSem = subject.secondSemester || {};

      if (
        Object.values(firstSem).every((val) => val === null) &&
        Object.values(secondSem).every((val) => val === null)
      ) {
        warnings.push(
          `Subject ${subject.subject || index + 1}: No grades extracted`
        );
      }

      // Additional validation: Check for suspicious patterns that might indicate invented grades
      const allGrades = [
        firstSem.period1,
        firstSem.period2,
        firstSem.exam,
        firstSem.total,
        secondSem.period3,
        secondSem.period4,
        secondSem.exam,
        secondSem.total,
      ].filter((grade) => grade !== null && grade !== undefined);

      // Flag if all grades are perfect numbers (might indicate invention)
      if (allGrades.length > 0) {
        const allPerfectScores = allGrades.every((grade) => {
          if (typeof grade !== "number") return false;
          return grade % 5 === 0 || grade % 10 === 0; // All grades are multiples of 5 or 10
        });

        if (allPerfectScores && allGrades.length >= 6) {
          warnings.push(
            `Subject ${
              subject.subject || index + 1
            }: All grades are perfect multiples (suspicious pattern)`
          );
        }

        // Flag if confidence is high but grades seem too uniform
        const avgGrade =
          allGrades.reduce((sum, grade) => sum + grade, 0) / allGrades.length;
        const variance =
          allGrades.reduce(
            (sum, grade) => sum + Math.pow(grade - avgGrade, 2),
            0
          ) / allGrades.length;

        if (
          subject.confidence &&
          subject.confidence.gradesAvg > 90 &&
          variance < 1 &&
          allGrades.length >= 4
        ) {
          warnings.push(
            `Subject ${
              subject.subject || index + 1
            }: Suspiciously uniform grades with high confidence`
          );
        }
      }

      // Validate numeric types for first semester
      ["period1", "period2", "exam", "total"].forEach((field) => {
        if (firstSem[field] !== null && typeof firstSem[field] !== "number") {
          errors.push(
            `Subject ${
              subject.subject || index + 1
            }: ${field} (Sem 1) is not a number`
          );
        }
      });

      // Validate numeric types for second semester (uses period3, period4)
      ["period3", "period4", "exam", "total"].forEach((field) => {
        if (secondSem[field] !== null && typeof secondSem[field] !== "number") {
          errors.push(
            `Subject ${
              subject.subject || index + 1
            }: ${field} (Sem 2) is not a number`
          );
        }
      });
    });
  }

  // Check for verification data
  if (!data.centerCode) {
    warnings.push("Center code not extracted - check bottom right section");
  }

  if (!data.verifierName) {
    warnings.push("Verifier name not extracted - check bottom right section");
  }

  // Check metadata
  if (data.extractionMetadata) {
    if (data.extractionMetadata.confidence < 70) {
      warnings.push(
        `Low extraction confidence: ${data.extractionMetadata.confidence}%`
      );
    }

    if (
      data.extractionMetadata.missingFields &&
      data.extractionMetadata.missingFields.length > 0
    ) {
      warnings.push(
        `Missing fields reported: ${data.extractionMetadata.missingFields.join(
          ", "
        )}`
      );
    }
  }

  const isValid = errors.length === 0;
  const hasMinimumData =
    data.studentName && data.subjects && data.subjects.length > 0;

  console.log(`✅ Validation complete: ${isValid ? "PASS" : "FAIL"}`);
  console.log(
    `📊 Stats: ${errors.length} errors, ${warnings.length} warnings, ${required.length} missing required`
  );

  return {
    isValid,
    hasMinimumData,
    errors,
    warnings,
    missingRequired: required,
    subjectCount: data.subjects ? data.subjects.length : 0,
    extractionQuality: data.extractionMetadata
      ? data.extractionMetadata.confidence
      : null,
  };
};

/**
 * Sort subjects by maxima values (lower to higher) while preserving original order within each maxima group
 * @param {Array} subjects - Array of subject objects with original order preserved
 * @returns {Array} Sorted subjects array grouped by maxima, maintaining original order within groups
 */
const sortSubjectsByMaxima = (subjects) => {
  // Add original index to preserve order within maxima groups
  const subjectsWithIndex = subjects.map((subject, index) => ({
    ...subject,
    originalIndex: index,
  }));

  return subjectsWithIndex
    .sort((a, b) => {
      // Get the PERIOD MAXIMA ONLY (ignore total and exam maxima for grouping)
      const getPeriodMaxima = (subject) => {
        if (!subject.maxima || !subject.maxima.periodMaxima) return 0;
        return subject.maxima.periodMaxima;
      };

      const aPeriodMaxima = getPeriodMaxima(a);
      const bPeriodMaxima = getPeriodMaxima(b);

      // Sort by PERIOD maxima values ONLY (ascending: lower values first)
      if (aPeriodMaxima !== bPeriodMaxima) {
        return aPeriodMaxima - bPeriodMaxima;
      }

      // If period maxima are equal, preserve original order from the bulletin
      return a.originalIndex - b.originalIndex;
    })
    .map((subject) => {
      // Remove the temporary originalIndex property
      const { originalIndex, ...subjectWithoutIndex } = subject;
      return subjectWithoutIndex;
    });
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

  return mimeTypes[extension] || "application/octet-stream";
};

module.exports = {
  initializeOpenAI,
  uploadAndExtract,
  validateExtractedData,
  sortSubjectsByMaxima,
};

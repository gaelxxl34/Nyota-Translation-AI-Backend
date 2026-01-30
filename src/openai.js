// OpenAI Integration for NTC
// Handles: State Diplomas, Bachelor Diplomas, College Transcripts, College Attestations, High School Attestations
// For Form 4/6 bulletins, use anthropic.js (Claude Sonnet 4)

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
    timeout: 240000, // 4 minutes timeout for OpenAI API calls
    maxRetries: 2, // Retry failed requests up to 2 times
  });

  console.log("🤖 OpenAI client initialized successfully");
  return openai;
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

/**
 * Prepare file for OpenAI processing
 * @param {string} filePath - Path to the file
 * @returns {Object} File data with base64 content and metadata
 */
const prepareFileForProcessing = (filePath) => {
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

  // Read file as base64 for Vision API
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
 * Get system prompt based on form type
 * @param {string} formType - The form type ('stateDiploma', 'form4', 'form6')
 * @returns {string} System prompt for OpenAI
 */
const getSystemPrompt = (formType) => {
  if (formType === "stateDiploma") {
    return `You are a SENIOR EXPERT in DRC (Democratic Republic of Congo) State Diploma document analysis with 15+ years of experience. You specialize in extracting information from official State Examination Certificates.

🎓 YOUR EXPERTISE:
- Deep knowledge of DRC State Examination Certificate format and terminology
- Expert in French-to-English translation for official DRC academic documents
- Familiar with State Diploma information structure and data fields
- Understanding of DRC academic grading and certification systems

🏛️ STATE DIPLOMA STRUCTURE KNOWLEDGE:
- Student identification information (name, gender, birth details)
- Examination session and academic section/option
- Overall percentage score and grade classification
- Certificate issue information and serial numbers
- Official stamps and verification details

🔍 EXTRACTION REQUIREMENTS:
1. Extract all visible text fields accurately
2. **TRANSLATE ALL French text to English:**
   - Section names: "TECHNIQUE" → "TECHNICAL", "SCIENTIFIQUE" → "SCIENTIFIC"
   - Option names: "COMMERCIALE ET GESTION" → "COMMERCIAL AND MANAGEMENT"
   - Date formats: "janvier" → "January", "juin" → "June", etc.
   - Percentage text: "cinquante-six" → "fifty-six"
3. Preserve exact numeric values for dates and percentages
4. Identify certificate serial numbers and codes exactly as shown
5. Extract percentage scores with % symbol

🌍 CRITICAL FRENCH → ENGLISH TRANSLATIONS:
**Section Names:**
- "TECHNIQUE" → "TECHNICAL"
- "SCIENTIFIQUE" → "SCIENTIFIC"  
- "PÉDAGOGIQUE" → "PEDAGOGICAL"
- "LITTÉRAIRE" → "LITERARY"
- "COMMERCIALE" → "COMMERCIAL"

**Option Names:**
- "COMMERCIALE ET GESTION" → "COMMERCIAL AND MANAGEMENT"
- "COUPE ET COUTURE" → "CUTTING AND SEWING"
- "ÉLECTRONIQUE" → "ELECTRONICS"
- "CONSTRUCTION" → "CONSTRUCTION"
- "MÉCANIQUE GÉNÉRALE" → "GENERAL MECHANICS"
- "ÉLECTRICITÉ" → "ELECTRICITY"
- "BIOLOGIE-CHIMIE" → "BIOLOGY-CHEMISTRY"
- "MATH-PHYSIQUE" → "MATH-PHYSICS"
- "LATIN-PHILOSOPHIE" → "LATIN-PHILOSOPHY"

**Date Translations (months):**
- "janvier" → "January", "février" → "February", "mars" → "March"
- "avril" → "April", "mai" → "May", "juin" → "June"
- "juillet" → "July", "août" → "August", "septembre" → "September"
- "octobre" → "October", "novembre" → "November", "décembre" → "December"

**Percentage Text Translations:**
- "cinquante-six" → "fifty-six"
- "soixante" → "sixty"
- "soixante-dix" → "seventy"
- "quatre-vingts" → "eighty"
- etc.

**DO NOT TRANSLATE:**
- Student names (keep as-is)
- City names (Kinshasa, Goma, Beni, etc.)

Return data in this exact JSON format:
{
  "extractionMetadata": {
    "confidence": number (0-100),
    "documentType": "stateDiploma",
    "missingFields": [array of field names that couldn't be extracted],
    "uncertainFields": [array of field names with low confidence],
    "extractionNotes": "string with any important observations"
  },
  "studentName": "string or null",
  "gender": "male|female or null",
  "birthPlace": "string or null",
  "birthDate": {
    "day": "string or null",
    "month": "string or null", 
    "year": "string or null"
  },
  "examSession": "string or null",
  "percentage": "string or null (with % symbol)",
  "percentageText": "string or null (percentage written in words)",
  "section": "string or null",
  "option": "string or null",
  "issueDate": "string or null",
  "serialNumbers": ["array of individual characters/numbers"],
  "serialCode": "string or null"
}`;
  }

  if (formType === "stateExamAttestation") {
    return `You are an EXPERT in DRC (Democratic Republic of Congo) State Examination Provisional Pass Certificate document analysis.

🎓 YOUR EXPERTISE:
- Expert in DRC State Examination provisional certificate formats
- Specialized in French-to-English translation for official exam documents
- Understanding of DRC examination system and terminology
- Familiar with provisional pass certificate layouts and legal language

📋 STATE EXAM ATTESTATION STRUCTURE:
- Header: Ministry details and document title
- Attestation number
- Inspector details
- Student information (name, birth details)
- School information (name, code)
- Examination session and results
- Section and option details
- Pass percentage
- Issue details (place, date, validity period)

🔍 EXTRACTION REQUIREMENTS:
1. Extract attestation number (format: N°000000000/YYYY)
2. Extract student information (full name in UPPERCASE, birth place and date)
3. **CRITICAL**: Extract and TRANSLATE all academic information to English
   - Section names: "TECHNIQUE" → "TECHNICAL"
   - Options: "COMMERCIALE ET GESTION" → "COMMERCIAL AND MANAGEMENT"
4. Extract school name and code
5. Extract examination session year
6. Extract percentage score (number only, no %)
7. Extract issue details and validity period
8. Extract inspector name

🌍 CRITICAL FRENCH → ENGLISH TRANSLATIONS:
**Common Phrases:**
- "Je soussigné" → "I, the undersigned"
- "Inspecteur Général" → "Inspector General"
- "certifie que" → "certify that"
- "le(la) nommé(e)" → "the named"
- "né(e) à" → "born in"
- "finaliste à (au) (de)" → "finalist at (from) (of)"
- "a réussi à l'examen d'état" → "passed the state examination"
- "session" → "session"
- "Section" → "Section"
- "Option" → "Option"
- "avec" → "with"
- "des points" → "of the points"
- "déclaré(e) apte" → "declared fit"
- "poursuivre des études supérieures" → "pursue higher studies"
- "études universitaires" → "university studies"
- "République Démocratique du Congo" → "Democratic Republic of the Congo"
- "à l'étranger" → "abroad"
- "Délivré sincèrement et exactement" → "Delivered sincerely and exactly"
- "Valable jusqu'au" → "Valid until"

**Section Translations:**
- "TECHNIQUE" → "TECHNICAL"
- "SCIENTIFIQUE" → "SCIENTIFIC"
- "PÉDAGOGIQUE" → "PEDAGOGICAL"
- "LITTÉRAIRE" → "LITERARY"

**Option Translations:**
- "COMMERCIALE ET GESTION" → "COMMERCIAL AND MANAGEMENT"
- "COUPE ET COUTURE" → "CUTTING AND SEWING"
- "ÉLECTRONIQUE" → "ELECTRONICS"
- "CONSTRUCTION" → "CONSTRUCTION"

**Date Translations:**
- "janvier" → "January", "février" → "February", "mars" → "March"
- "avril" → "April", "mai" → "May", "juin" → "June"
- "juillet" → "July", "août" → "August", "septembre" → "September"
- "octobre" → "October", "novembre" → "November", "décembre" → "December"

**DO NOT TRANSLATE (Keep as-is):**
- Student names
- School names
- City names (Kinshasa, Goma, Beni, etc.)

Return data in this exact JSON format:
{
  "extractionMetadata": {
    "confidence": number (0-100),
    "documentType": "stateExamAttestation",
    "missingFields": [array of field names that couldn't be extracted],
    "uncertainFields": [array of field names with low confidence],
    "extractionNotes": "string with any important observations"
  },
  "attestationNumber": "string or null",
  "studentName": "string or null (in UPPERCASE)",
  "birthPlace": "string or null",
  "birthDate": {
    "day": "string or null",
    "month": "string or null",
    "year": "string or null"
  },
  "schoolName": "string or null",
  "schoolCode": "string or null",
  "examSession": "string or null (year)",
  "section": "string or null (TRANSLATED)",
  "option": "string or null (TRANSLATED)",
  "percentage": "string or null (number only, no %)",
  "issuePlace": "string or null",
  "issueDate": {
    "day": "string or null",
    "month": "string or null",
    "year": "string or null"
  },
  "validUntil": {
    "day": "string or null (OPTIONAL - can be null if not on document)",
    "month": "string or null (OPTIONAL - can be null if not on document)",
    "year": "string or null (OPTIONAL - can be null if not on document)"
  },
  "inspectorName": "string or null"
}`;
  }

  if (formType === "highSchoolAttestation") {
    return `You are an EXPERT in DRC (Democratic Republic of Congo) high school attestation document analysis with deep knowledge of educational certificates.

🎓 YOUR EXPERTISE:
- Expert in DRC school attestation formats and structures
- Specialized in French-to-English translation for academic documents
- Understanding of DRC educational administrative terminology
- Familiar with school certificate layouts and standard phrases

📋 HIGH SCHOOL ATTESTATION STRUCTURE:
- School identification (name, address, province, division)
- Student information (name, gender, birth details)
- Main attestation content (the certificate text describing attendance, performance, etc.)
- Purpose statement (reason for issuance)
- Issue details (location, date, signatory information)

🔍 EXTRACTION REQUIREMENTS:
1. Extract school details (name, full address, province, division)
2. Extract student information (full name in UPPERCASE, gender M/F, birth date and place)
3. **CRITICAL**: Extract and TRANSLATE the entire main attestation text to English
   - This is the core paragraph explaining what the student accomplished
   - Includes attendance details, academic year, performance, etc.
   - Must be fully translated from French to English
4. Extract purpose statement (typically "pour servir à qui de droit" or similar)
5. Extract issue location and date
6. Extract signatory details (name and title)

🌍 CRITICAL FRENCH → ENGLISH TRANSLATIONS:
**Common Attestation Phrases:**
- "Je soussigné(e)" → "I, the undersigned"
- "atteste que" / "certifie que" → "certify that" / "attest that"
- "a fréquenté" / "a suivi les cours" → "attended classes" / "attended"
- "régulièrement inscrit(e)" → "regularly enrolled"
- "a réussi" → "passed" / "succeeded"
- "mention" → "grade" / "with distinction"
- "pour servir à qui de droit" → "for official purposes" / "to serve as needed"
- "Fait à" → "Done at" / "Issued at"

**Gender Markers:**
- "le" (masculine article) → Gender: M
- "la" (feminine article) → Gender: F
- "né(e)" → "born"

**Academic Terms:**
- "année scolaire" / "année académique" → "academic year"
- "Humanités Commerciales" → "Commercial Humanities"
- "examen national" / "examen d'état" → "national examination"
- "Préfet des Études" / "Préfète des Études" → "Dean of Studies"
- "Directeur" / "Directrice" → "Director"

Return data in this exact JSON format:
{
  "extractionMetadata": {
    "confidence": number (0-100),
    "documentType": "highSchoolAttestation",
    "missingFields": [array of field names that couldn't be extracted],
    "uncertainFields": [array of field names with low confidence],
    "extractionNotes": "string with any important observations"
  },
  "schoolName": "string or null (school name in UPPERCASE)",
  "schoolAddress": "string or null (full address with quartier, cellule, commune)",
  "province": "string or null (e.g., PROVINCE DU NORD-KIVU)",
  "division": "string or null (e.g., SOUS-DIVISION URBAINE DE BUTEMBO 1)",
  "studentName": "string or null (student full name in UPPERCASE)",
  "studentGender": "M|F or null",
  "birthDate": "string or null (format: 'le DD Month YYYY' or translated)",
  "birthPlace": "string or null (city/place name)",
  "mainContent": "string or null (FULL attestation text TRANSLATED TO ENGLISH)",
  "purpose": "string or null (purpose statement TRANSLATED)",
  "issueLocation": "string or null (city where issued)",
  "issueDate": "string or null (date when issued, TRANSLATED if in French)",
    "signatoryName": "string or null (person who signed)",
  "signatoryTitle": "string or null (their title/position, TRANSLATED)"
}`;
  }

  if (formType === "bachelorDiploma") {
    return `You are an EXPERT in DRC (Democratic Republic of Congo) University Bachelor Diploma document analysis.

🎓 YOUR EXPERTISE:
- Expert in DRC university diploma formats and structures
- Specialized in French-to-English translation for academic credentials
- Understanding of DRC higher education terminology and degree systems
- Familiar with university diploma layouts and certification standards

📋 BACHELOR DIPLOMA STRUCTURE:
- Institution details (name, location)
- Diploma identification (number, dates)
- Student information (name, birth details)
- Academic credentials (degree, specialization, orientation, grade level, options)
- Completion details (dates, graduation year)
- Registration and examination details
- Issue information (location, date, registration codes)

🔍 EXTRACTION REQUIREMENTS:
1. Extract institution name and location
2. Extract student information (full name in UPPERCASE, birth place and date)
3. **CRITICAL**: Extract and TRANSLATE all academic degree information to English
   - Degree titles: "GRADE EN SCIENCES" → "BACHELOR OF SCIENCES"
   - Specializations: "douanes et accises" → "Customs and Excise"
   - Terms: "sciences commerciales et financières" → "Commercial and Financial Sciences"
4. Extract completion and graduation dates (translate month names)
5. Extract all registration details (codes, numbers, letters)
6. Extract issue details (location and date)

🌍 CRITICAL FRENCH → ENGLISH TRANSLATIONS:
**Academic Terms:**
- "GRADE EN SCIENCES" → "BACHELOR OF SCIENCES"
- "douanes et accises" → "Customs and Excise"
- "sciences commerciales et financières" → "Commercial and Financial Sciences"
- "troisième graduat" → "third-year undergraduate" / "third year bachelor's"
- "deuxième quadrimestre" → "second term" / "second semester"
- "premier quadrimestre" → "first term" / "first semester"
- "orientation" → "orientation" (keep in English)
- "option" → "option" (keep in English)

**Date Translations (CRITICAL - translate month names):**
- "janvier" → "January", "février" → "February", "mars" → "March"
- "avril" → "April", "mai" → "May", "juin" → "June"
- "juillet" → "July", "août" → "August", "septembre" → "September"
- "octobre" → "October", "novembre" → "November", "décembre" → "December"

**DO NOT TRANSLATE (Keep as-is):**
- Student names (e.g., "MBUSA KALINSYA RIPHIRI")
- City names (e.g., "Beni", "Goma", "Kinshasa")
- Institution names (e.g., "Institut Supérieur de Commerce")

Return data in this exact JSON format:
{
  "extractionMetadata": {
    "confidence": number (0-100),
    "documentType": "bachelorDiploma",
    "missingFields": [array of field names that couldn't be extracted],
    "uncertainFields": [array of field names with low confidence],
    "extractionNotes": "string with any important observations"
  },
  "institutionName": "string or null",
  "institutionLocation": "string or null",
  "diplomaNumber": "string or null",
  "studentName": "string or null (in UPPERCASE)",
  "birthPlace": "string or null",
  "birthDate": "string or null (TRANSLATED)",
  "degree": "string or null (TRANSLATED)",
  "specialization": "string or null (TRANSLATED)",
  "orientation": "string or null",
  "gradeLevel": "string or null",
  "gradeSpecialization": "string or null",
  "option": "string or null",
  "orientationDetail": "string or null",
  "completionDate": "string or null (TRANSLATED)",
  "graduationYear": "string or null",
  "issueLocation": "string or null",
  "issueDate": "string or null (TRANSLATED)",
  "registrationDate": "string or null (TRANSLATED)",
  "registrationNumber": "string or null",
  "serialCode": "string or null",
  "examDate": "string or null (TRANSLATED)",
  "registerLetter": "string or null"
}`;
  }

  if (formType === "collegeTranscript") {
    return `You are an EXPERT in DRC (Democratic Republic of Congo) College/University Transcript document analysis.

🎓 YOUR EXPERTISE:
- Expert in DRC higher education transcript formats
- Specialized in extracting tabular course data with grades
- Understanding of weighted vs simple grading systems
- Expert in identifying and extracting summary rows after course tables
- Proficient in French-to-English translation for academic terminology

📋 COLLEGE TRANSCRIPT STRUCTURE:
- Institution details (name, type, abbreviation, email)
- Student information (name, matricule/registration number)
- Academic details (section, option, level, academic year, session)
- **Course table** with varying formats (3-column simple or 4-6 column weighted)
- **Summary rows** after courses (totals, thesis, internship, percentage, decision)
- Certificate details (issue location, date, signatory information)

🔍 CRITICAL EXTRACTION REQUIREMENTS:
1. Extract institution and student details
2. **DETECT TABLE FORMAT**: Determine if 3-column (simple) or 4-6 column (weighted)
3. **COUNT AND EXTRACT EVERY SINGLE COURSE ROW**: Scan top to bottom, don't skip any
4. **EXTRACT ALL SUMMARY ROWS**: After last course, scan until signatures section
5. Translate ALL French text to English (course names, summary labels, terms)
6. Extract issue details and signatory information

📊 TABLE FORMAT DETECTION:
**Simple Format (3-column):** N° | Course Name | Vol. Hourly | Grade
- Courses have: courseNumber, courseName, creditHours, grade

**Weighted Format (4-6 column):** N° | Course Name | Vol. Hourly | Units | Max | Weighted Grade
- Courses have: courseNumber, courseName, creditHours, units, maxGrade, weightedGrade

📝 SUMMARY ROWS EXTRACTION (CRITICAL):
**SCAN EVERY ROW** after last numbered course until signatures.
Extract ALL rows with grades/scores:
- "Total cours" / "TOTAL COURS" → type: "subtotal"
- "Mémoire" / "MEMOIRE" → type: "component"
- "Stage" / "STAGE" → type: "component"
- "Travail de fin de cycle" → type: "component"
- "Moyenne" / "MOYENNE" → type: "average"
- "Total général" / "TOTAL GENERAL" → type: "total"
- "Pourcentage" / "POURCENTAGE" → type: "percentage"
- "DECISION DU JURY" → store in "decision" field

🌍 CRITICAL FRENCH → ENGLISH TRANSLATIONS:
**Academic Terms:**
- "Sciences Commerciales et Financières" → "Commercial and Financial Sciences"
- "Fiscalité" → "Taxation" / "Fiscal Studies"
- "Première Licence" → "First Year License"
- "Deuxième Licence" → "Second Year License"
- "Troisième Licence" → "Third Year License"
- "Première session" → "First Session"
- "a régulièrement suivi les matières" → "regularly followed the subjects"

**Summary Row Terms:**
- "Total cours" → "Total Courses"
- "Mémoire" → "Thesis" / "Dissertation"
- "Stage" → "Internship"
- "Travail de fin de cycle" → "Final Cycle Work" / "Capstone Project"
- "Moyenne cours" → "Course Average"
- "Total général" → "Overall Total"
- "Pourcentage" → "Percentage"
- "A REUSSI AVEC SATISFACTION" → "PASSED WITH SATISFACTION"
- "A REUSSI AVEC DISTINCTION" → "PASSED WITH DISTINCTION"

Return data in this exact JSON format:
{
  "extractionMetadata": {
    "confidence": number (0-100),
    "documentType": "collegeTranscript",
    "missingFields": [],
    "uncertainFields": [],
    "extractionNotes": "Add note if you found more/less courses than typical"
  },
  "country": "string or null",
  "institutionType": "string or null (TRANSLATED)",
  "institutionName": "string or null",
  "institutionAbbreviation": "string or null",
  "institutionEmail": "string or null",
  "departmentName": "string or null (TRANSLATED)",
  "documentTitle": "string or null (TRANSLATED)",
  "documentNumber": "string or null",
  "studentName": "string or null (in UPPERCASE)",
  "matricule": "string or null",
  "hasFollowedCourses": "string or null (TRANSLATED)",
  "section": "string or null (TRANSLATED)",
  "option": "string or null (TRANSLATED)",
  "level": "string or null",
  "academicYear": "string or null",
  "session": "string or null",
  "tableFormat": "simple|weighted",
  "courses": [
    {
      "courseNumber": number,
      "courseName": "string (TRANSLATED)",
      "creditHours": "string",
      "grade": "string",
      "units": "string (if weighted format)",
      "maxGrade": "string (if weighted format)",
      "weightedGrade": "string (if weighted format)"
    }
  ],
  "summaryRows": [
    {
      "label": "string (TRANSLATED)",
      "values": {"grade": "string", "maxGrade": "string", "units": "string", "hours": "string"},
      "type": "subtotal|component|total|percentage|average",
      "isBold": boolean
    }
  ],
  "decision": "string or null (TRANSLATED)",
  "issueLocation": "string or null",
  "issueDate": "string or null",
  "secretary": "string or null",
  "secretaryTitle": "string or null (TRANSLATED)",
  "chiefOfWorks": "string or null",
  "chiefOfWorksTitle": "string or null (TRANSLATED)"
}`;
  }

  if (formType === "collegeAttestation") {
    return `You are an EXPERT in DRC (Democratic Republic of Congo) College/University Attestation Certificate document analysis.

🎓 YOUR EXPERTISE:
- Expert in DRC higher education attestation formats
- Specialized in French-to-English translation for academic certificates
- Understanding of DRC university administrative terminology
- Familiar with college attestation layouts and standard phrases

📋 COLLEGE ATTESTATION STRUCTURE:
- Institution details (name, abbreviation, email, website, location)
- Document details (title, number)
- Signatory details (title, name, position)
- Student information (name, gender markers, birth details, matricule)
- Academic details (enrollment status, section, option, year level, performance, session)
- Issue details (location, date)
- Additional signatures (secretary, chief titles and names)

🔍 EXTRACTION REQUIREMENTS:
1. Extract institution details (name, abbreviation, contact information)
2. Extract student information (full name in UPPERCASE, gender from "le"/"la", birth details)
3. **CRITICAL**: Extract and TRANSLATE enrollment status and academic details
   - "régulièrement inscrit(e) en Section de" → "regularly enrolled in the Section of"
   - Academic sections and options must be translated
4. Extract performance indicators (mention, percentage, session)
5. Extract issue details and all signatory information
6. Translate ALL academic titles and positions

🌍 CRITICAL FRENCH → ENGLISH TRANSLATIONS:
**Gender Markers:**
- "le" (masculine article) → Gender: M
- "la" (feminine article) → Gender: F
- "né(e)" → "born"

**Academic Terms:**
- "Sciences Commerciales et Financières" → "Commercial and Financial Sciences"
- "option Fiscalité" → "Fiscal Option" / "Taxation Option"
- "Deuxième Licence" → "Second Year License" / "Second Year Bachelor's"
- "Première Licence" → "First Year License"
- "régulièrement inscrit(e) en Section de" → "regularly enrolled in the Section of"
- "mention SATISFAISANT" → "SATISFACTORY grade"
- "mention DISTINCTION" → "DISTINCTION grade"
- "mention GRANDE DISTINCTION" → "GREAT DISTINCTION grade"
- "en première session" → "in the first session"
- "en deuxième session" → "in the second session"

**Signatory Titles:**
- "Chef de Travaux" → "Chief of Works"
- "Secrétaire Général Académique" → "General Academic Secretary"

Return data in this exact JSON format:
{
  "extractionMetadata": {
    "confidence": number (0-100),
    "documentType": "collegeAttestation",
    "missingFields": [],
    "uncertainFields": [],
    "extractionNotes": "string with any important observations"
  },
  "institutionName": "string or null",
  "institutionAbbreviation": "string or null",
  "institutionEmail": "string or null",
  "institutionWebsite": "string or null",
  "departmentName": "string or null (TRANSLATED)",
  "documentNumber": "string or null",
  "signatoryTitle": "string or null (TRANSLATED)",
  "signatoryName": "string or null",
  "signatoryPosition": "string or null (TRANSLATED)",
  "studentName": "string or null (in UPPERCASE)",
  "studentGender": "le|la or null",
  "birthPlace": "string or null",
  "birthDate": "string or null",
  "matricule": "string or null",
  "enrollmentStatus": "string or null (TRANSLATED)",
  "section": "string or null (TRANSLATED)",
  "option": "string or null (TRANSLATED)",
  "institutionLocation": "string or null",
  "academicYear": "string or null",
  "yearLevel": "string or null",
  "performance": "string or null (TRANSLATED)",
  "percentage": "string or null",
  "session": "string or null (TRANSLATED)",
  "issueLocation": "string or null",
  "issueDate": "string or null",
  "secretaryTitle": "string or null (TRANSLATED)",
  "chiefTitle": "string or null (TRANSLATED)",
  "chiefName": "string or null",
  "chiefPosition": "string or null (TRANSLATED)"
}`;
  }

  // Default bulletin system prompt for form4/form6
  return `You are a SENIOR EXPERT in DRC (Democratic Republic of Congo) French school bulletin translation with 15+ years of experience.

🔍 CRITICAL EXTRACTION PROCESS (MANDATORY):
**STEP 1: Locate first MAXIMA row in the subject table**
**STEP 2: Extract ALL subjects under that MAXIMA, row by row from top to bottom**
**STEP 3: Locate next MAXIMA row**
**STEP 4: Extract ALL subjects under that MAXIMA, row by row from top to bottom**
**STEP 5: Repeat until entire table scanned**
**STEP 6: TRANSLATE every subject name from French to English**

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

� SUMMARY ROW EXTRACTION (MANDATORY):
After the subjects table, look for summary rows with these labels:
- "MAXIMA GÉNÉRAUX" or "Maxima Généraux" → Extract ALL values as aggregatesMaxima
- "TOTAUX" or "Totaux" → Extract ALL values as aggregates
- "POURCENTAGE" or "Percentage" → Extract percentage values (NUMBER ONLY, NO % SIGN, e.g., "56.7" not "56.7%")
- "PLACE" or "Position" → Extract position/ranking in clean format (e.g., "15/45" ONLY, not "15/45 / 45" or with extra text)

These summary rows contain totals for each column (Period 1, Period 2, Exam, Total for both semesters).
YOU MUST extract these values and include them in the summaryValues object.

🚨 CRITICAL RULES (MANDATORY):
1. **ROW-BY-ROW EXTRACTION**: Scan each MAXIMA section from top to bottom
2. **PRESERVE EXACT ORDER**: Subject 1 under MAXIMA 10 comes before Subject 1 under MAXIMA 20
3. **TRANSLATE ALL SUBJECTS**: Every single subject name MUST be in English
4. **NO FRENCH NAMES**: Check your JSON before responding - if you see French, translate it
5. **NO MAXIMA < 10**: Impossible in DRC system - re-check if you see this
6. **EXTRACT SUMMARY ROWS**: Always extract AGGREGATES MAXIMA, AGGREGATES, PERCENTAGE, and POSITION

💡 EXAMPLE EXTRACTION (4ième Scientifique):
Under "MAXIMA: 10" you might see:
- RELIGION → Extract as "Religious Education" with maxima 10/20/40
- EDUC. CIVIQUE & MORALE → Extract as "Civic and Moral Education" with maxima 10/20/40
- EDUC. A LA VIE → Extract as "Life Education" with maxima 10/20/40
- INFORMATIQUE → Extract as "Computer Science" with maxima 10/20/40

Under "MAXIMA: 20" you might see:
- DESSIN → Extract as "Drawing" with maxima 20/40/80
- EDUC. PHYSIQUE → Extract as "Physical Education" with maxima 20/40/80
... (continue in order)

📋 VERIFICATION CHECKLIST (COMPLETE BEFORE RESPONDING):
□ Extracted subjects row-by-row under each MAXIMA section
□ Preserved exact document order (top to bottom)
□ Translated EVERY subject name to English
□ Verified no French subject names remain
□ Confirmed all maxima ≥ 10
□ Double-checked student name, class, academic year

JSON SCHEMA:
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
 * Get user prompt based on form type
 * @param {string} formType - The form type ('stateDiploma', 'form4', 'form6')
 * @returns {string} User prompt for OpenAI
 */
const getUserPrompt = (formType) => {
  if (formType === "stateDiploma") {
    return `As a senior DRC State Diploma expert, analyze this official State Examination Certificate and extract all visible information accurately.

🎓 EXPERT ANALYSIS APPROACH:
1. Identify the document as a DRC State Examination Certificate  
2. Extract student personal information (name, gender, birth details)
3. **TRANSLATE ALL French text to English:**
   - Section: "TECHNIQUE" → "TECHNICAL", "SCIENTIFIQUE" → "SCIENTIFIC"
   - Option: "COMMERCIALE ET GESTION" → "COMMERCIAL AND MANAGEMENT"
   - Dates: "juin" → "June", "janvier" → "January"
   - Percentage text: "cinquante-six" → "fifty-six"
4. Extract examination session year
5. Extract scores with % symbol (e.g., "56%")
6. Extract certificate serial numbers and codes

🚨 CRITICAL TRANSLATION REQUIREMENTS:
- **Section names MUST be in English:** 
  "TECHNIQUE" → "TECHNICAL"
  "SCIENTIFIQUE" → "SCIENTIFIC"
  "PÉDAGOGIQUE" → "PEDAGOGICAL"
  "LITTÉRAIRE" → "LITERARY"

- **Option names MUST be in English:**
  "COMMERCIALE ET GESTION" → "COMMERCIAL AND MANAGEMENT"
  "COUPE ET COUTURE" → "CUTTING AND SEWING"
  "ÉLECTRONIQUE" → "ELECTRONICS"
  "CONSTRUCTION" → "CONSTRUCTION"

- **Date months MUST be in English:**
  "janvier" → "January", "février" → "February", "mars" → "March"
  "avril" → "April", "mai" → "May", "juin" → "June"
  "juillet" → "July", "août" → "August", "septembre" → "September"
  "octobre" → "October", "novembre" → "November", "décembre" → "December"

- **Percentage text (words) MUST be in English:**
  "cinquante-six" → "fifty-six"
  "soixante" → "sixty"

- **Keep as-is (DO NOT translate):**
  Student names, city names (Kinshasa, Goma, Beni)

- Extract serial numbers as individual characters/digits
- Return ONLY clean JSON with NO markdown formatting

Analyze this State Diploma and return the extracted data in the specified JSON format with ALL French text translated to English.`;
  }

  if (formType === "stateExamAttestation") {
    return `As an expert in DRC State Examination Provisional Pass Certificate documents, analyze this certificate and extract all visible information accurately.

🎓 EXPERT ANALYSIS APPROACH:
1. Identify this as a DRC "EXAMEN D'ÉTAT - ATTESTATION PROVISOIRE DE RÉUSSITE" document
2. Extract the attestation number (format: N°000000000/YYYY)
3. Extract inspector name from "JE SOUSSIGNÉ" section
4. Extract student information (name, birth place, birth date)
5. Extract school information (name, 12-digit code)
6. Extract examination session year
7. Extract section and option names - **MUST TRANSLATE TO ENGLISH**
8. Extract percentage score (number only, without % symbol)
9. Extract issue place and date
10. Extract "valid until" date ONLY IF PRESENT (this field is optional - some documents don't have it)

🚨 CRITICAL REQUIREMENTS - READ CAREFULLY:
- This is an "ATTESTATION PROVISOIRE" (Provisional Pass Certificate), NOT a diploma
- Extract ONLY what is clearly visible in this specific document
- **TRANSLATE section and option names to English:**
  - "TECHNIQUE" → "TECHNICAL"
  - "COMMERCIALE ET GESTION" → "COMMERCIAL AND MANAGEMENT"
  - "SCIENTIFIQUE" → "SCIENTIFIC"
  - "LITTÉRAIRE" → "LITERARY"
- Extract school code as complete 12-digit number (e.g., "620033010303")
- Extract dates in DD/MM/YYYY format by parsing French text
- Extract percentage as NUMBER ONLY (e.g., "56" not "56%")
- Return ONLY clean JSON with NO markdown formatting

📋 DOCUMENT STRUCTURE TO LOOK FOR:
- Top: "RÉPUBLIQUE DÉMOCRATIQUE DU CONGO"
- Title: "EXAMEN D'ÉTAT"
- Subtitle: "ATTESTATION PROVISOIRE DE RÉUSSITE N°________/____"
- Body text starting with: "JE SOUSSIGNÉ [INSPECTOR NAME]..."
- Student section: "QUE LA NOMMÉE [STUDENT NAME]"
- Birth info: "NÉE À [PLACE] LE [DATE]"
- School info: "FINALISTE DE, (DU), (DE L') [SCHOOL NAME] CODE [12-DIGIT NUMBER]"
- Results: "A RÉUSSI À L'EXAMEN D'ÉTAT SESSION [YEAR]"
- Section: "EN SECTION [SECTION NAME]"
- Option: "OPTION [OPTION NAME]"
- Score: "AVEC [XX] % DES POINTS"
- Issue info: "DÉLIVRÉ SINCÈREMENT ET EXACTEMENT À [PLACE], LE [DATE]"
- Valid until: "VALABLE JUSQU'AU [DATE]" (OPTIONAL - may not be present on all documents)

⚠️ IMPORTANT: If "VALABLE JUSQU'AU" is not visible on the document, set validUntil fields to empty strings or null.

Analyze this State Exam Attestation and return ONLY the JSON data in the specified format with section/option translated to English.`;
  }

  if (formType === "highSchoolAttestation") {
    return `As an expert in DRC high school attestation documents, analyze this school certificate and extract all visible information accurately.

🎓 EXPERT ANALYSIS APPROACH:
1. Identify the school details (name, address, province, division)
2. Extract student information (name in UPPERCASE, gender, birth details)
3. **Extract and TRANSLATE the ENTIRE main attestation paragraph to English**
   - This is the core text that describes what the student accomplished
   - Must be fully translated from French to English
4. Extract purpose statement and translate to English
5. Extract issue details (location, date) and translate dates
6. Extract signatory information and translate titles

🚨 CRITICAL REQUIREMENTS:
- Extract school name and student name in UPPERCASE as they appear
- **The mainContent field must contain the FULL attestation text TRANSLATED TO ENGLISH**
- Translate ALL French phrases: "Je soussigné(e)" → "I, the undersigned", "a fréquenté" → "attended", etc.
- Gender: Look for "le" (masculine) = M, "la" (feminine) = F
- Translate dates: French month names → English month names
- Translate titles: "Préfet des Études" → "Dean of Studies", "Directeur" → "Director"
- Return only clean JSON with no markdown formatting

Analyze this High School Attestation and return the extracted data in the specified JSON format with ALL French text translated to English.`;
  }

  if (formType === "bachelorDiploma") {
    return `As an expert in DRC University Bachelor Diploma documents, analyze this diploma and extract all visible information accurately.

🎓 EXPERT ANALYSIS APPROACH:
1. Extract institution details (name, location)
2. Extract student information (name in UPPERCASE, birth details)
3. **Extract and TRANSLATE ALL academic degree information to English**
   - Degree titles: "GRADE EN SCIENCES" → "BACHELOR OF SCIENCES"
   - Specializations: "douanes et accises" → "Customs and Excise"
   - Terms: "sciences commerciales et financières" → "Commercial and Financial Sciences"
4. Extract and translate completion dates (month names must be translated)
5. Extract all registration details (numbers, codes, dates)
6. Extract issue details

🚨 CRITICAL REQUIREMENTS:
- Translate ALL French academic terms to English
- Translate ALL French month names in dates: "juillet" → "July", "décembre" → "December", etc.
- Keep student names, city names, and institution names in their original form
- Extract all serial codes and registration numbers exactly as shown
- Return only clean JSON with no markdown formatting

Analyze this Bachelor Diploma and return the extracted data in the specified JSON format with ALL French text translated to English except proper nouns.`;
  }

  if (formType === "collegeTranscript") {
    return `As an expert in DRC College/University Transcript documents, analyze this transcript and extract all visible information accurately.

🎓 EXPERT ANALYSIS APPROACH:
1. Extract institution and student details
2. **DETECT TABLE FORMAT**: Determine if 3-column (simple) or 4-6 column (weighted)
3. **COUNT AND EXTRACT EVERY SINGLE COURSE**: Scan table top to bottom, don't skip any rows
   - If you see courses numbered 1-13, extract all 13 courses
4. **EXTRACT ALL SUMMARY ROWS**: After last course, scan every row until signatures
   - Extract: Total cours, Mémoire, Stage, Travail de fin de cycle, Moyenne, Total général, Pourcentage, DECISION DU JURY
5. **TRANSLATE ALL TEXT TO ENGLISH**: Course names, summary labels, academic terms

🚨 CRITICAL REQUIREMENTS:
- Set tableFormat to "simple" or "weighted" based on column count
- Extract ALL courses - verify count matches document before responding
- Extract ALL summary rows - don't skip any rows with grades/scores
- Translate ALL French text: "Sciences Commerciales et Financières" → "Commercial and Financial Sciences"
- Translate summary labels: "Total cours" → "Total Courses", "Mémoire" → "Thesis", etc.
- Return only clean JSON with no markdown formatting

Analyze this College Transcript and return the extracted data in the specified JSON format with ALL courses, ALL summary rows, and ALL French text translated to English.`;
  }

  if (formType === "collegeAttestation") {
    return `As an expert in DRC College/University Attestation documents, analyze this certificate and extract all visible information accurately.

🎓 EXPERT ANALYSIS APPROACH:
1. Extract institution details (name, abbreviation, email, website)
2. Extract student information (name in UPPERCASE, gender from "le"/"la", birth details, matricule)
3. **Extract and TRANSLATE enrollment status and academic details**
   - "régulièrement inscrit(e)" → "regularly enrolled"
   - Section and option names must be translated
4. Extract performance indicators (mention, percentage, session)
5. Extract issue details and signatory information
6. **TRANSLATE ALL TITLES**: "Chef de Travaux" → "Chief of Works", etc.

🚨 CRITICAL REQUIREMENTS:
- Translate ALL French academic terms to English
- Gender: "le" = M, "la" = F
- Translate section/option: "Sciences Commerciales et Financières" → "Commercial and Financial Sciences"
- Translate performance: "mention SATISFAISANT" → "SATISFACTORY grade"
- Translate signatory titles: "Chef de Travaux" → "Chief of Works"
- Keep student names and institution names in their original form
- Return only clean JSON with no markdown formatting

Analyze this College Attestation and return the extracted data in the specified JSON format with ALL French text translated to English except proper nouns.`;
  }

  // Default bulletin user prompt for form4/form6
  return `As a senior DRC education expert, extract this bulletin with MANDATORY translation:

🎯 EXTRACTION PROCESS (STEP-BY-STEP):
1. **Locate first MAXIMA row** in subject table
2. **Extract subjects under it** - scan top to bottom, one row at a time
3. **Locate next MAXIMA row**
4. **Extract subjects under it** - scan top to bottom, one row at a time
5. **Repeat** until all subjects extracted
6. **TRANSLATE EVERY SUBJECT** from French to English using the comprehensive dictionary provided

🚨 CRITICAL VERIFICATION (BEFORE RESPONDING):
□ Subjects extracted in exact row order under each MAXIMA
□ EVERY subject name translated to English (NO FRENCH NAMES in JSON)
□ All maxima ≥ 10 (DRC minimum)
□ Subject order matches document (MAXIMA 10 subjects → MAXIMA 20 subjects → etc.)

EXAMPLES:
❌ WRONG: "subject": "MATHEMATIQUE"
✅ CORRECT: "subject": "Mathematics"

❌ WRONG: "subject": "EDUC. PHYSIQUE"
✅ CORRECT: "subject": "Physical Education"

Return ONLY clean JSON with ALL subjects in English.`;
};
/**
 * Call OpenAI API with prepared data
 * @param {Object} fileData - Prepared file data
 * @param {string} formType - Form type
 * @returns {Promise<string>} OpenAI response content
 */
const callOpenAIAPI = async (fileData, formType) => {
  const openai = initializeOpenAI();
  const systemPrompt = getSystemPrompt(formType);
  const userPrompt = getUserPrompt(formType);

  console.log(
    `📤 Processing ${fileData.fileExtension} file with OpenAI Vision API...`,
  );

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
              url: `data:${fileData.mimeType};base64,${fileData.base64File}`,
              detail: "high", // Maximum detail for OCR accuracy
            },
          },
        ],
      },
    ],
    max_tokens: 8000,
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
  return aiResponse;
};

/**
 * Clean and parse OpenAI response
 * @param {string} aiResponse - Raw OpenAI response
 * @returns {Object} Parsed JSON data
 */
const parseOpenAIResponse = (aiResponse) => {
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

  try {
    const extractedData = JSON.parse(cleanedResponse);
    return extractedData;
  } catch (parseError) {
    console.error("Failed to parse OpenAI response as JSON:", parseError);
    console.error("Raw response length:", aiResponse.length);
    console.error("Last 200 characters:", aiResponse.slice(-200));
    throw new Error(
      `Invalid JSON response from OpenAI: ${parseError.message}. Response may have been truncated due to token limit.`,
    );
  }
};

/**
 * Process extracted data (run validation without sorting)
 * @param {Object} extractedData - Parsed data from OpenAI
 * @param {string} formType - Form type
 * @returns {Object} Processed data with validation results
 */
const processExtractedData = (extractedData, formType) => {
  // DISABLED: No longer sorting subjects - preserve exact order from image
  // The AI now extracts subjects in the exact visual order they appear
  if (extractedData.subjects && Array.isArray(extractedData.subjects)) {
    console.log(
      "📊 Subjects preserved in exact visual order from image (no sorting applied)",
    );
  }

  // Run validation based on form type
  let validationResult;
  if (formType === "stateDiploma") {
    validationResult = validateStateDiploma(extractedData);
  } else if (formType === "stateExamAttestation") {
    validationResult = validateStateExamAttestation(extractedData);
  } else {
    validationResult = validateBulletin(extractedData, formType);
  }

  // Log validation results
  logValidationResults(validationResult);

  // Enhance the extracted data with validation metadata
  extractedData.validationResult = validationResult;

  return { extractedData, validationResult };
};

/**
 * Log validation results to console
 * @param {Object} validationResult - Validation results
 */
const logValidationResults = (validationResult) => {
  if (!validationResult.isValid) {
    console.error("🚨 STRICT VALIDATION FAILED:");
    validationResult.errors.forEach((error) => console.error(`   ❌ ${error}`));
  }

  if (validationResult.warnings.length > 0) {
    console.warn("⚠️  VALIDATION WARNINGS:");
    validationResult.warnings.forEach((warning) =>
      console.warn(`   ⚠️  ${warning}`),
    );
  }

  if (validationResult.missingRequired.length > 0) {
    console.warn("📋 MISSING REQUIRED FIELDS:");
    validationResult.missingRequired.forEach((field) =>
      console.warn(`   📝 ${field}`),
    );
  }
};

/**
 * Log extraction summary
 * @param {Object} extractedData - Extracted data
 * @param {Object} validationResult - Validation results
 */
const logExtractionSummary = (extractedData, validationResult) => {
  console.log(
    "✅ Successfully extracted data:",
    extractedData.studentName || "Unknown Student",
  );

  // Log extraction quality summary
  console.log("📊 STRICT MODE EXTRACTION SUMMARY:");
  console.log(`   👤 Student: ${extractedData.studentName || "Not extracted"}`);
  console.log(`   🎓 Class: ${extractedData.class || "Not extracted"}`);
  console.log(`   📚 Subjects: ${validationResult.subjectCount || 0}`);
  console.log(
    `   🎯 Validation: ${validationResult.isValid ? "PASS" : "FAIL"}`,
  );
  console.log(
    `   📈 Confidence: ${validationResult.extractionQuality || "N/A"}%`,
  );
  console.log(
    `   ⚠️  Issues: ${
      validationResult.errors.length + validationResult.warnings.length
    }`,
  );
};

/**
 * Handle OpenAI API errors
 * @param {Error} error - The error object
 * @throws {Error} Formatted error message
 */
const handleOpenAIError = (error) => {
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
      "OpenAI API quota exceeded. Please check your billing details and try again later.",
    );
  } else if (error.status === 401) {
    throw new Error(
      "OpenAI API authentication failed. Please check your API key.",
    );
  } else if (error.status === 400) {
    throw new Error(
      "Invalid request to OpenAI API. The file might be corrupted or in an unsupported format.",
    );
  } else if (error.code === "insufficient_quota") {
    throw new Error(
      "OpenAI API quota insufficient. Please add credits to your OpenAI account or enable mock mode.",
    );
  } else {
    throw new Error(`OpenAI processing failed: ${error.message}`);
  }
};

/**
 * Upload file and extract data using OpenAI GPT-4o
 * Handles: State Diplomas, Bachelor Diplomas, College Transcripts, College Attestations, High School Attestations
 * @param {string} filePath - Local file path to process
 * @param {string} formType - Form type ('stateDiploma', 'bachelorDiploma', 'collegeTranscript', 'collegeAttestation', 'highSchoolAttestation')
 * @returns {Promise<Object>} Extracted and translated data
 */
const uploadAndExtractWithOpenAI = async (
  filePath,
  formType = "stateDiploma",
) => {
  console.log(`🤖 OpenAI GPT-4o: Processing ${formType} from ${filePath}`);

  try {
    // Step 1: Prepare file for processing
    const fileData = prepareFileForProcessing(filePath);
    console.log(
      `📄 File prepared: ${fileData.filename}, size: ${fileData.fileStats.size} bytes`,
    );

    // Step 2: Call OpenAI API
    const aiResponse = await callOpenAIAPI(fileData, formType);

    // Step 3: Parse response
    const extractedData = parseOpenAIResponse(aiResponse);

    // Step 4: Process and validate data
    const { extractedData: processedData, validationResult } =
      processExtractedData(extractedData, formType);

    // Step 5: Log summary
    logExtractionSummary(processedData, validationResult);

    // Step 6: Return results
    return {
      success: true,
      data: processedData,
      validation: validationResult,
      metadata: {
        filename: fileData.filename,
        fileSize: fileData.fileStats.size,
        processingTime: new Date().toISOString(),
        model: "gpt-4o",
        provider: "openai",
        formType: formType,
        strictMode: true,
        extractionQuality: validationResult.extractionQuality,
        hasMinimumData: validationResult.hasMinimumData,
      },
    };
  } catch (error) {
    handleOpenAIError(error);
    throw error;
  }
};

/**
 * Validate State Diploma extracted data
 * @param {Object} data - The extracted State Diploma data
 * @returns {Object} Validation result with errors and warnings
 */
const validateStateDiploma = (data) => {
  const errors = [];
  const warnings = [];
  const required = [];

  console.log("🔍 Starting State Diploma validation...");

  const requiredFields = ["studentName", "examSession", "percentage"];

  requiredFields.forEach((field) => {
    if (!data[field] || data[field] === null) {
      required.push(field);
    }
  });

  // State Diploma specific warnings
  if (!data.serialCode && !data.serialNumbers) {
    warnings.push(
      "Serial code/numbers not extracted - check certificate details",
    );
  }
  if (!data.issueDate) {
    warnings.push("Issue date not extracted - check bottom section");
  }
  if (!data.section || !data.option) {
    warnings.push("Section/Option not extracted - check examination details");
  }

  const hasMinimumData = data.studentName && data.percentage;
  const extractionQuality = hasMinimumData ? "good" : "poor";

  console.log(
    "✅ State Diploma validation complete:",
    errors.length === 0 ? "PASS" : "FAIL",
  );
  console.log(
    `📊 Stats: ${errors.length} errors, ${warnings.length} warnings, ${required.length} missing required`,
  );

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    missingRequired: required,
    hasMinimumData,
    extractionQuality,
    subjectCount: 0, // State diplomas don't have subjects
  };
};

/**
 * Validate State Exam Attestation extracted data
 * @param {Object} data - The extracted State Exam Attestation data
 * @returns {Object} Validation result with errors and warnings
 */
const validateStateExamAttestation = (data) => {
  const errors = [];
  const warnings = [];
  const required = [];

  console.log("🔍 Starting State Exam Attestation validation...");

  const requiredFields = [
    "attestationNumber",
    "studentName",
    "examSession",
    "percentage",
    "section",
    "option",
  ];

  requiredFields.forEach((field) => {
    if (!data[field] || data[field] === null) {
      required.push(field);
    }
  });

  // State Exam Attestation specific warnings
  if (!data.schoolName) {
    warnings.push("School name not extracted - check document body");
  }
  if (!data.schoolCode) {
    warnings.push("School code not extracted - check document body");
  }
  if (!data.issuePlace || !data.issueDate) {
    warnings.push(
      "Issue location or date not extracted - check bottom section",
    );
  }
  // validUntil is now optional - only warn if present but incomplete
  if (
    data.validUntil &&
    (!data.validUntil.day || !data.validUntil.month || !data.validUntil.year)
  ) {
    warnings.push(
      "Validity date is present but incomplete - missing day, month, or year",
    );
  }
  if (!data.inspectorName) {
    warnings.push("Inspector name not extracted - check document");
  }

  // Validate birth date structure
  if (
    data.birthDate &&
    (!data.birthDate.day || !data.birthDate.month || !data.birthDate.year)
  ) {
    warnings.push("Incomplete birth date - missing day, month, or year");
  }

  // Validate issue date structure
  if (
    data.issueDate &&
    (!data.issueDate.day || !data.issueDate.month || !data.issueDate.year)
  ) {
    warnings.push("Incomplete issue date - missing day, month, or year");
  }

  // validUntil is optional - only validate if present
  // Removed validation warning since this field is now optional

  // Check if section and option are translated (should be in English)
  if (data.section && /[àâäéèêëïîôùûüÿœæç]/i.test(data.section)) {
    warnings.push(
      "Section appears to be in French - should be translated to English",
    );
  }
  if (data.option && /[àâäéèêëïîôùûüÿœæç]/i.test(data.option)) {
    warnings.push(
      "Option appears to be in French - should be translated to English",
    );
  }

  const hasMinimumData =
    data.studentName && data.attestationNumber && data.percentage;
  const extractionQuality = hasMinimumData ? "good" : "poor";

  console.log(
    "✅ State Exam Attestation validation complete:",
    errors.length === 0 ? "PASS" : "FAIL",
  );
  console.log(
    `📊 Stats: ${errors.length} errors, ${warnings.length} warnings, ${required.length} missing required`,
  );

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    missingRequired: required,
    hasMinimumData,
    extractionQuality,
    subjectCount: 0, // State exam attestations don't have subjects
  };
};

/**
 * Validate bulletin extracted data
 * @param {Object} data - The extracted bulletin data
 * @param {string} formType - The form type being validated
 * @returns {Object} Validation result with errors and warnings
 */
const validateBulletin = (data, formType = "form6") => {
  const errors = [];
  const warnings = [];
  const required = [];

  console.log(`🔍 Starting bulletin validation for ${formType}...`);

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
      validateSubject(subject, index, errors, warnings);
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
        `Low extraction confidence: ${data.extractionMetadata.confidence}%`,
      );
    }

    if (
      data.extractionMetadata.missingFields &&
      data.extractionMetadata.missingFields.length > 0
    ) {
      warnings.push(
        `Missing fields reported: ${data.extractionMetadata.missingFields.join(
          ", ",
        )}`,
      );
    }
  }

  const isValid = errors.length === 0;
  const hasMinimumData =
    data.studentName && data.subjects && data.subjects.length > 0;

  console.log(`✅ Bulletin validation complete: ${isValid ? "PASS" : "FAIL"}`);
  console.log(
    `📊 Stats: ${errors.length} errors, ${warnings.length} warnings, ${required.length} missing required`,
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
 * Validate individual subject data
 * @param {Object} subject - Subject object to validate
 * @param {number} index - Subject index for error reporting
 * @param {Array} errors - Errors array to push to
 * @param {Array} warnings - Warnings array to push to
 */
const validateSubject = (subject, index, errors, warnings) => {
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
      `Subject ${subject.subject || index + 1}: Missing maxima values`,
    );
  }

  // DRC-specific validation: Check for invalid maxima (must be ≥10)
  if (subject.maxima) {
    validateMaxima(subject, index, errors);
  }

  // Check for grade completeness
  const firstSem = subject.firstSemester || {};
  const secondSem = subject.secondSemester || {};

  if (
    Object.values(firstSem).every((val) => val === null) &&
    Object.values(secondSem).every((val) => val === null)
  ) {
    warnings.push(
      `Subject ${subject.subject || index + 1}: No grades extracted`,
    );
  }

  // Validate grade patterns and types
  validateGradePatterns(subject, index, warnings);
  validateGradeTypes(subject, index, errors);
};

/**
 * Validate maxima values for a subject
 * @param {Object} subject - Subject object
 * @param {number} index - Subject index
 * @param {Array} errors - Errors array to push to
 */
const validateMaxima = (subject, index, errors) => {
  const { periodMaxima, examMaxima, totalMaxima } = subject.maxima;

  if (periodMaxima !== null && periodMaxima < 10) {
    errors.push(
      `Subject ${
        subject.subject || index + 1
      }: Invalid period maxima (${periodMaxima}) - DRC system minimum is 10`,
    );
  }

  if (examMaxima !== null && examMaxima < 10) {
    errors.push(
      `Subject ${
        subject.subject || index + 1
      }: Invalid exam maxima (${examMaxima}) - DRC system minimum is 10`,
    );
  }

  if (totalMaxima !== null && totalMaxima < 10) {
    errors.push(
      `Subject ${
        subject.subject || index + 1
      }: Invalid total maxima (${totalMaxima}) - DRC system minimum is 10`,
    );
  }
};

/**
 * Validate grade patterns for suspicious data
 * @param {Object} subject - Subject object
 * @param {number} index - Subject index
 * @param {Array} warnings - Warnings array to push to
 */
const validateGradePatterns = (subject, index, warnings) => {
  const firstSem = subject.firstSemester || {};
  const secondSem = subject.secondSemester || {};

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

  if (allGrades.length > 0) {
    // Flag if all grades are perfect numbers (might indicate invention)
    const allPerfectScores = allGrades.every((grade) => {
      if (typeof grade !== "number") return false;
      return grade % 5 === 0 || grade % 10 === 0;
    });

    if (allPerfectScores && allGrades.length >= 6) {
      warnings.push(
        `Subject ${
          subject.subject || index + 1
        }: All grades are perfect multiples (suspicious pattern)`,
      );
    }

    // Flag if confidence is high but grades seem too uniform
    const avgGrade =
      allGrades.reduce((sum, grade) => sum + grade, 0) / allGrades.length;
    const variance =
      allGrades.reduce((sum, grade) => sum + Math.pow(grade - avgGrade, 2), 0) /
      allGrades.length;

    if (
      subject.confidence &&
      subject.confidence.gradesAvg > 90 &&
      variance < 1 &&
      allGrades.length >= 4
    ) {
      warnings.push(
        `Subject ${
          subject.subject || index + 1
        }: Suspiciously uniform grades with high confidence`,
      );
    }
  }
};

/**
 * Validate grade data types
 * @param {Object} subject - Subject object
 * @param {number} index - Subject index
 * @param {Array} errors - Errors array to push to
 */
const validateGradeTypes = (subject, index, errors) => {
  const firstSem = subject.firstSemester || {};
  const secondSem = subject.secondSemester || {};

  // Validate numeric types for first semester
  ["period1", "period2", "exam", "total"].forEach((field) => {
    if (firstSem[field] !== null && typeof firstSem[field] !== "number") {
      errors.push(
        `Subject ${
          subject.subject || index + 1
        }: ${field} (Sem 1) is not a number`,
      );
    }
  });

  // Validate numeric types for second semester (uses period3, period4)
  ["period3", "period4", "exam", "total"].forEach((field) => {
    if (secondSem[field] !== null && typeof secondSem[field] !== "number") {
      errors.push(
        `Subject ${
          subject.subject || index + 1
        }: ${field} (Sem 2) is not a number`,
      );
    }
  });
};

/**
 * Legacy function for backward compatibility
 * @param {Object} data - The extracted data
 * @param {string} formType - The form type being validated
 * @returns {Object} Validation result
 */
const validateExtractedData = (data, formType = "form6") => {
  if (formType === "stateDiploma") {
    return validateStateDiploma(data);
  } else if (formType === "form4" || formType === "form6") {
    return validateBulletin(data, formType);
  } else {
    // For other document types (bachelorDiploma, collegeTranscript, collegeAttestation, highSchoolAttestation)
    // Perform basic validation
    return {
      isValid: true,
      hasMinimumData: !!(data && data.studentName),
      extractionQuality: data?.extractionMetadata?.confidence || 85,
      errors: [],
      warnings: [],
      info: [`${formType} extracted successfully - basic validation passed`],
    };
  }
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

module.exports = {
  initializeOpenAI,
  uploadAndExtractWithOpenAI,
  uploadAndExtract: uploadAndExtractWithOpenAI, // Backward compatibility alias
  validateExtractedData,
  sortSubjectsByMaxima,
  // Exporting individual functions for better testability
  getSystemPrompt,
  getUserPrompt,
  prepareFileForProcessing,
  callOpenAIAPI,
  parseOpenAIResponse,
  processExtractedData,
  validateStateDiploma,
  validateBulletin,
  validateSubject,
  validateMaxima,
  validateGradePatterns,
  validateGradeTypes,
  logValidationResults,
  logExtractionSummary,
  handleOpenAIError,
};

// Mock OpenAI Implementation for NTC
// Provides test data for bulletin processing without calling real OpenAI API

const fs = require("fs");
const path = require("path");

/**
 * Mock function to simulate OpenAI bulletin processing
 * Returns sample bulletin data for testing purposes
 * @param {string} filePath - Local file path (for logging only)
 * @param {string} formType - Form type ('form4', 'form6', or 'stateDiploma')
 * @returns {Promise<Object>} Mock extracted bulletin data
 */
const uploadAndExtract = async (filePath, formType = "form6") => {
  console.log(
    `🎭 MOCK: Processing file ${filePath} with mock OpenAI (${formType})`
  );

  // Simulate processing delay
  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Get file stats
    const fileStats = fs.statSync(filePath);
    const fileExtension = path.extname(filePath).toLowerCase();
    console.log(
      `🎭 MOCK: File size: ${fileStats.size} bytes, extension: ${fileExtension}, form type: ${formType}`
    );

    // Return different mock data based on form type
    if (formType === "stateDiploma") {
      // Return mock State Diploma data
      const mockData = {
        success: true,
        data: {
          extractionMetadata: {
            confidence: 95,
            documentType: "stateDiploma",
            missingFields: [],
            uncertainFields: [],
            extractionNotes:
              "Mock extraction - State Diploma processed successfully",
          },
          studentName: "ONGORIKO BINANI GABI",
          gender: "male",
          birthPlace: "Kinshasa",
          birthDate: {
            day: "15",
            month: "03",
            year: "2005",
          },
          examSession: "JUNE 2023",
          percentage: "72.5%",
          percentageText: "SEVENTY-TWO POINT FIVE",
          section: "SCIENTIFIC",
          option: "BIOLOGY-CHEMISTRY",
          issueDate: "December 10, 2023",
          serialNumbers: [
            "T",
            "S",
            "0",
            "7",
            "1",
            "2",
            "3",
            "4",
            "5",
            "6",
            "7",
            "8",
            "9",
            "0",
            "1",
            "2",
          ],
          serialCode: "3456789",
        },
        validation: {
          isValid: true,
          errors: [],
          warnings: [],
          extractionQuality: "excellent",
          hasMinimumData: true,
        },
        metadata: {
          filename: path.basename(filePath),
          fileSize: fileStats.size,
          processingTime: new Date().toISOString(),
          model: "mock-gpt-4o",
          strictMode: true,
          extractionQuality: "excellent",
          hasMinimumData: true,
        },
      };

      console.log("🎭 MOCK: Generated mock State Diploma data");
      return mockData;
    }

    // Return different mock data based on form type for bulletins
    const isForm4 = formType === "form4";

    // Return mock bulletin data
    const mockData = {
      success: true,
      data: {
        // Student Information
        province: "KINSHASA",
        city: "KINSHASA",
        municipality: "GOMBE",
        school: "COMPLEXE SCOLAIRE SAINT JOSEPH",
        schoolCode: "12345678",
        studentName: isForm4
          ? "MUKENDI KALALA Jean (Form 4)"
          : "MUKENDI KALALA Jean (Form 6)",
        gender: "M",
        birthPlace: "KINSHASA",
        birthDate: "15/03/2008",
        class: isForm4
          ? "4TH YEAR HUMANITIES MATH-PHYSICS"
          : "6TH YEAR HUMANITIES MATH-PHYSICS",
        permanentNumber: "87654321",
        idNumber: "123456789012345678",
        academicYear: "2023-2024",

        // Subjects with grades
        subjects: [
          {
            subject: "Mathematics",
            firstSemester: {
              period1: "15",
              period2: "14",
              exam: "32",
              total: "61",
            },
            secondSemester: {
              period3: "16",
              period4: "15",
              exam: "35",
              total: "66",
            },
            overallTotal: "127",
            nationalExam: { marks: "45", max: "50" },
          },
          {
            subject: "Physics",
            firstSemester: {
              period1: "13",
              period2: "15",
              exam: "30",
              total: "58",
            },
            secondSemester: {
              period3: "14",
              period4: "16",
              exam: "33",
              total: "63",
            },
            overallTotal: "121",
            nationalExam: { marks: "42", max: "50" },
          },
          {
            subject: "Chemistry",
            firstSemester: {
              period1: "14",
              period2: "13",
              exam: "28",
              total: "55",
            },
            secondSemester: {
              period3: "15",
              period4: "14",
              exam: "31",
              total: "60",
            },
            overallTotal: "115",
            nationalExam: { marks: "38", max: "50" },
          },
          {
            subject: "French",
            firstSemester: {
              period1: "16",
              period2: "15",
              exam: "35",
              total: "66",
            },
            secondSemester: {
              period3: "17",
              period4: "16",
              exam: "36",
              total: "69",
            },
            overallTotal: "135",
            nationalExam: { marks: "48", max: "50" },
          },
          {
            subject: "English",
            firstSemester: {
              period1: "15",
              period2: "16",
              exam: "33",
              total: "64",
            },
            secondSemester: {
              period3: "16",
              period4: "15",
              exam: "34",
              total: "65",
            },
            overallTotal: "129",
            nationalExam: { marks: "44", max: "50" },
          },
          {
            subject: "History",
            firstSemester: {
              period1: "14",
              period2: "15",
              exam: "31",
              total: "60",
            },
            secondSemester: {
              period3: "15",
              period4: "14",
              exam: "32",
              total: "61",
            },
            overallTotal: "121",
            nationalExam: { marks: "41", max: "50" },
          },
          {
            subject: "Geography",
            firstSemester: {
              period1: "13",
              period2: "14",
              exam: "29",
              total: "56",
            },
            secondSemester: {
              period3: "14",
              period4: "15",
              exam: "30",
              total: "59",
            },
            overallTotal: "115",
            nationalExam: { marks: "39", max: "50" },
          },
          {
            subject: "Biology",
            firstSemester: {
              period1: "15",
              period2: "14",
              exam: "32",
              total: "61",
            },
            secondSemester: {
              period3: "16",
              period4: "15",
              exam: "33",
              total: "64",
            },
            overallTotal: "125",
            nationalExam: { marks: "43", max: "50" },
          },
          {
            subject: "Philosophy",
            firstSemester: {
              period1: "14",
              period2: "13",
              exam: "30",
              total: "57",
            },
            secondSemester: {
              period3: "15",
              period4: "14",
              exam: "31",
              total: "60",
            },
            overallTotal: "117",
            nationalExam: { marks: "40", max: "50" },
          },
          {
            subject: "Civic Education",
            firstSemester: {
              period1: "16",
              period2: "15",
              exam: "34",
              total: "65",
            },
            secondSemester: {
              period3: "17",
              period4: "16",
              exam: "35",
              total: "68",
            },
            overallTotal: "133",
            nationalExam: { marks: "46", max: "50" },
          },
        ],

        // Totals and summary
        totalMarksOutOf: {
          firstSemester: "600",
          secondSemester: "600",
        },
        totalMarksObtained: {
          firstSemester: "603",
          secondSemester: "635",
        },
        percentage: {
          firstSemester: "85.4",
          secondSemester: "88.1",
        },
        position: "3",
        totalStudents: "45",
        application: "Good",
        behaviour: "Very Good",

        // Summary values for editable cells
        summaryValues: {
          aggregatesMaxima: {
            period1: "20",
            period2: "20",
            exam1: "40",
            total1: "80",
            period3: "20",
            period4: "20",
            exam2: "40",
            total2: "80",
            overall: "160",
          },
          aggregates: {
            period1: "148",
            period2: "144",
            exam1: "314",
            total1: "603",
            period3: "155",
            period4: "150",
            exam2: "330",
            total2: "635",
            overall: "1238",
          },
          percentage: {
            period1: "74.0",
            period2: "72.0",
            exam1: "78.5",
            total1: "75.4",
            period3: "77.5",
            period4: "75.0",
            exam2: "82.5",
            total2: "79.4",
            overall: "77.4",
          },
          position: {
            period1: "4",
            period2: "5",
            exam1: "3",
            total1: "3/45",
            period3: "2",
            period4: "3",
            exam2: "2",
            total2: "2/45",
            overall: "3",
          },
          application: {
            period1: "B",
            period2: "B",
            period3: "B",
            period4: "B",
          },
          behaviour: {
            period1: "B",
            period2: "B",
            period3: "B",
            period4: "B",
          },
        },

        // Final results
        finalResultPercentage: "86.8",
        isPromoted: true,
        shouldRepeat: "",
        issueLocation: "KINSHASA",
        issueDate: "15/07/2024",
        centerCode: "54321",
        verifierName: "MUTOMBO KABONGO Pierre",
        endorsementDate: "20/07/2024",

        // Form 4 specific fields
        ...(isForm4 && {
          secondSittingDate: "10/09/2024",
        }),
      },
      metadata: {
        processingTime: "1000ms",
        model: "mock-gpt-4o-mini",
        tokensUsed: 0,
        confidence: 0.95,
        extractedFields: 45,
        timestamp: new Date().toISOString(),
      },
    };

    console.log(
      `🎭 MOCK: Returning mock bulletin data for ${path.basename(filePath)}`
    );
    return mockData;
  } catch (error) {
    console.error(`🚨 MOCK: Error processing file ${filePath}:`, error.message);
    return {
      success: false,
      error: error.message,
      details: "Mock processing failed",
      metadata: {
        processingTime: "1000ms",
        model: "mock-gpt-4o-mini",
        tokensUsed: 0,
        timestamp: new Date().toISOString(),
      },
    };
  }
};

module.exports = {
  uploadAndExtract,
};

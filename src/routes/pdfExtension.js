// Function to extend the PDF export route to handle State Diploma template
const extendPdfRouteForStateDiploma = (router) => {
  // This function modifies the PDF generation process for the State Diploma template
  // by intercepting requests with tempId documents from the temp_documents collection

  // Save a reference to the original route handler
  const originalHandler = router.stack.find(
    (layer) => layer.route && layer.route.path === "/export-pdf"
  ).handle;

  // Replace with our enhanced version
  router.stack.forEach((layer) => {
    if (layer.route && layer.route.path === "/export-pdf") {
      const wrappedHandler = async (req, res) => {
        try {
          const { firestoreId } = req.body;

          // Check if this is a temp document ID for a State Diploma
          if (firestoreId && firestoreId.startsWith("temp_diploma_")) {
            console.log(
              "🎓 Detected State Diploma temp document:",
              firestoreId
            );

            // Modified workflow for State Diploma
            const admin = require("firebase-admin");
            const { initializeFirebaseAdmin } = require("../auth");

            initializeFirebaseAdmin();
            const db = admin.firestore();

            // Get the temp document
            const tempDoc = await db
              .collection("temp_documents")
              .doc(firestoreId)
              .get();

            if (!tempDoc.exists) {
              console.error("❌ Temp document not found:", firestoreId);
              return res.status(404).json({
                error: "Temporary diploma document not found",
              });
            }

            const tempData = tempDoc.data();

            // Modify the request object to include the diploma data
            req.body.templateType = tempData.templateType || "stateDiploma";
            req.body.diplomaData = tempData.diplomaData;

            // Also modify the waitSelector if it's for a state diploma
            if (tempData.templateType === "stateDiploma") {
              req.body.waitSelector = "#state-diploma-template";

              // Set landscape orientation for State Diploma
              if (!req.body.pdfOptions) req.body.pdfOptions = {};
              req.body.pdfOptions.landscape = true;
              req.body.pdfOptions.format = "A4";
            }

            console.log(
              "✅ Successfully prepared State Diploma data for PDF generation"
            );
          }

          // Call the original handler with our modified request
          return originalHandler(req, res);
        } catch (error) {
          console.error("❌ Error in State Diploma PDF handler:", error);
          return res.status(500).json({
            error: "Failed to process State Diploma PDF request",
            details: error.message,
          });
        }
      };

      // Replace the route handler
      layer.handle = wrappedHandler;
    }
  });

  console.log("✅ PDF export route extended for State Diploma template");
  return router;
};

module.exports = { extendPdfRouteForStateDiploma };

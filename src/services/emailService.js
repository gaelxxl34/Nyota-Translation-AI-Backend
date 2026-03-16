// Email Service for NTC
// Handles sending emails via SendGrid

const sgMail = require("@sendgrid/mail");

// Initialize SendGrid with API key
const initializeSendGrid = () => {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    console.warn("⚠️ SENDGRID_API_KEY not set — emails will be logged only");
    return false;
  }
  sgMail.setApiKey(apiKey);
  console.log("✅ SendGrid initialized");
  return true;
};

const sendGridReady = initializeSendGrid();

const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || "noreply@nyotatranslate.com";
const FROM_NAME = "Nyota Translation Center";

/**
 * Send an email via SendGrid (or log it in dev if key is missing)
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML body
 * @param {string} [options.text] - Plain text fallback
 */
const sendEmail = async ({ to, subject, html, text }) => {
  const msg = {
    to,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject,
    html,
    text: text || subject,
  };

  if (!sendGridReady) {
    console.log("📧 [DEV] Email would be sent:");
    console.log(`   To: ${to}`);
    console.log(`   Subject: ${subject}`);
    console.log(`   (Set SENDGRID_API_KEY to send real emails)`);
    return { success: true, dev: true };
  }

  try {
    await sgMail.send(msg);
    console.log(`📧 Email sent to ${to}: ${subject}`);
    return { success: true };
  } catch (error) {
    console.error("🚨 SendGrid error:", error.response?.body || error.message);
    throw new Error("Failed to send email");
  }
};

/**
 * Send email verification link to new user
 * @param {string} email - User email
 * @param {string} displayName - User display name
 * @param {string} verificationLink - Firebase email verification link
 */
const sendVerificationEmail = async (email, displayName, verificationLink) => {
  const subject = "Verify your email — Nyota Translation Center";
  const html = buildVerificationEmailHtml(displayName || "there", verificationLink);
  const text = `Welcome to Nyota Translation Center, ${displayName || "there"}! Please verify your email by visiting: ${verificationLink}`;

  return sendEmail({ to: email, subject, html, text });
};

/**
 * Build branded HTML for verification email
 * Uses NTC brand colors: primary blue #2563eb, secondary #0284c7, accent orange #e15815, dark #0B1120
 */
const buildVerificationEmailHtml = (name, link) => {
  const FRONTEND_URL = process.env.FRONTEND_URL_PROD || "https://nyotatranslate.com";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f9ff;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f0f9ff;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(37,99,235,0.08);">
          
          <!-- Header with logo -->
          <tr>
            <td style="background:#0B1120;padding:32px 40px;text-align:center;">
              <img src="${FRONTEND_URL}/logo-wide.png" alt="Nyota Translation Center" width="220" style="display:block;margin:0 auto 12px;max-width:220px;height:auto;" />
              <p style="color:#93c5fd;font-size:13px;margin:0;letter-spacing:0.5px;">
                AI-Powered Academic Document Translation
              </p>
            </td>
          </tr>

          <!-- Accent bar -->
          <tr>
            <td style="height:4px;background:linear-gradient(90deg,#2563eb 0%,#0284c7 50%,#e15815 100%);font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <h2 style="color:#0B1120;font-size:22px;margin:0 0 16px;font-weight:700;font-family:'Poppins','Inter',sans-serif;">
                Welcome, ${escapeHtml(name)}! 👋
              </h2>
              <p style="color:#374151;font-size:16px;line-height:1.7;margin:0 0 24px;">
                Thank you for joining <strong style="color:#2563eb;">Nyota Translation Center</strong>. 
                To start translating your academic documents, please verify your email address.
              </p>

              <!-- CTA Button -->
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 32px;">
                <tr>
                  <td style="border-radius:10px;background:linear-gradient(135deg,#2563eb 0%,#0284c7 100%);">
                    <a href="${escapeHtml(link)}" target="_blank" style="display:inline-block;padding:16px 48px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;border-radius:10px;letter-spacing:0.3px;">
                      ✉️&nbsp; Verify My Email
                    </a>
                  </td>
                </tr>
              </table>

              <p style="color:#6b7280;font-size:14px;line-height:1.5;margin:0 0 12px;">
                Or copy and paste this link into your browser:
              </p>
              <p style="color:#2563eb;font-size:13px;word-break:break-all;background:#eff6ff;padding:14px 16px;border-radius:8px;border:1px solid #dbeafe;margin:0 0 32px;">
                ${escapeHtml(link)}
              </p>

              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 24px;" />

              <p style="color:#9ca3af;font-size:13px;line-height:1.6;margin:0;">
                If you didn't create an account with Nyota Translation Center, you can safely ignore this email.
                This link will expire in 24 hours.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f8fafc;padding:24px 40px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="color:#6b7280;font-size:12px;margin:0 0 8px;">
                &copy; ${new Date().getFullYear()} Nyota Translation Center. All rights reserved.
              </p>
              <p style="color:#9ca3af;font-size:12px;margin:0;">
                <a href="${FRONTEND_URL}" style="color:#2563eb;text-decoration:none;font-weight:500;">nyotatranslate.com</a>
              </p>
            </td>
          </tr>

        </table>

        <!-- Sub-footer -->
        <table role="presentation" width="600" cellspacing="0" cellpadding="0">
          <tr>
            <td style="padding:20px 40px;text-align:center;">
              <p style="color:#9ca3af;font-size:11px;margin:0;">
                This is an automated message from Nyota Translation Center. Please do not reply to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

/**
 * Escape HTML to prevent XSS in email templates
 */
const escapeHtml = (str) => {
  const htmlEntities = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return String(str).replace(/[&<>"']/g, (char) => htmlEntities[char]);
};

// ============================================
// DOCUMENT LIFECYCLE EMAIL TEMPLATES
// ============================================

/**
 * Build a reusable branded email wrapper
 * @param {string} title - Email heading
 * @param {string} bodyHtml - Inner body HTML
 * @param {Object} [options]
 * @param {string} [options.ctaText] - Call-to-action button text
 * @param {string} [options.ctaUrl] - Call-to-action URL
 */
const buildBrandedEmail = (title, bodyHtml, options = {}) => {
  const FRONTEND_URL = process.env.FRONTEND_URL_PROD || "https://nyotatranslate.com";
  const { ctaText, ctaUrl } = options;

  const ctaBlock = ctaText && ctaUrl ? `
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px auto 32px;">
                <tr>
                  <td style="border-radius:10px;background:linear-gradient(135deg,#2563eb 0%,#0284c7 100%);">
                    <a href="${escapeHtml(ctaUrl)}" target="_blank" style="display:inline-block;padding:14px 40px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;letter-spacing:0.3px;">
                      ${escapeHtml(ctaText)}
                    </a>
                  </td>
                </tr>
              </table>` : "";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f0f9ff;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f0f9ff;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(37,99,235,0.08);">
          <tr>
            <td style="background:#0B1120;padding:24px 40px;text-align:center;">
              <img src="${FRONTEND_URL}/logo-wide.png" alt="Nyota Translation Center" width="180" style="display:block;margin:0 auto;max-width:180px;height:auto;" />
            </td>
          </tr>
          <tr>
            <td style="height:4px;background:linear-gradient(90deg,#2563eb 0%,#0284c7 50%,#e15815 100%);font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:36px 40px;">
              <h2 style="color:#0B1120;font-size:20px;margin:0 0 16px;font-weight:700;font-family:'Poppins','Inter',sans-serif;">
                ${title}
              </h2>
              ${bodyHtml}
              ${ctaBlock}
            </td>
          </tr>
          <tr>
            <td style="background-color:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="color:#6b7280;font-size:12px;margin:0 0 6px;">
                &copy; ${new Date().getFullYear()} Nyota Translation Center. All rights reserved.
              </p>
              <p style="color:#9ca3af;font-size:12px;margin:0;">
                <a href="${FRONTEND_URL}" style="color:#2563eb;text-decoration:none;">nyotatranslate.com</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

/**
 * Email: Document submitted for review
 */
const sendSubmissionConfirmation = async (email, displayName, { docId, formType, speedTier }) => {
  const FRONTEND_URL = process.env.FRONTEND_URL_PROD || "https://nyotatranslate.com";
  const tierLabel = speedTier?.label || "Standard";

  const body = `
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">
      Hi ${escapeHtml(displayName || "there")},
    </p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">
      Your document has been submitted for certified translation. A professional translator will review it shortly.
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" style="background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;padding:0;margin:0 0 20px;width:100%;">
      <tr><td style="padding:14px 20px;">
        <p style="color:#6b7280;font-size:13px;margin:0 0 4px;">Document Type</p>
        <p style="color:#0B1120;font-size:15px;font-weight:600;margin:0;">${escapeHtml(formType || "Document")}</p>
      </td></tr>
      <tr><td style="padding:0 20px 14px;">
        <p style="color:#6b7280;font-size:13px;margin:0 0 4px;">Speed Tier</p>
        <p style="color:#0B1120;font-size:15px;font-weight:600;margin:0;">${escapeHtml(tierLabel)}</p>
      </td></tr>
      <tr><td style="padding:0 20px 14px;">
        <p style="color:#6b7280;font-size:13px;margin:0 0 4px;">Reference</p>
        <p style="color:#2563eb;font-size:13px;font-family:monospace;margin:0;">${escapeHtml(docId)}</p>
      </td></tr>
    </table>`;

  const html = buildBrandedEmail("Document Submitted for Review ✅", body, {
    ctaText: "View My Documents",
    ctaUrl: `${FRONTEND_URL}/dashboard`,
  });

  return sendEmail({
    to: email,
    subject: "NTC: Your Document Has Been Submitted for Translation",
    html,
    text: `Hi ${displayName}, your document (${docId}) has been submitted for ${tierLabel} certified translation.`,
  });
};

/**
 * Email: Document re-submitted after rejection
 */
const sendResubmissionConfirmation = async (email, displayName, { docId, formType }) => {
  const FRONTEND_URL = process.env.FRONTEND_URL_PROD || "https://nyotatranslate.com";

  const body = `
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">
      Hi ${escapeHtml(displayName || "there")},
    </p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">
      Your <strong>${escapeHtml(formType || "document")}</strong> has been successfully re-submitted for review. A translator will review the updated document shortly.
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" style="background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;padding:0;margin:0 0 20px;width:100%;">
      <tr><td style="padding:14px 20px;">
        <p style="color:#6b7280;font-size:13px;margin:0 0 4px;">Document Type</p>
        <p style="color:#0B1120;font-size:15px;font-weight:600;margin:0;">${escapeHtml(formType || "Document")}</p>
      </td></tr>
      <tr><td style="padding:0 20px 14px;">
        <p style="color:#6b7280;font-size:13px;margin:0 0 4px;">Reference</p>
        <p style="color:#2563eb;font-size:13px;font-family:monospace;margin:0;">${escapeHtml(docId)}</p>
      </td></tr>
    </table>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">
      You will be notified once the review is complete.
    </p>`;

  const html = buildBrandedEmail("Document Re-submitted for Review 🔄", body, {
    ctaText: "View My Documents",
    ctaUrl: `${FRONTEND_URL}/dashboard`,
  });

  return sendEmail({
    to: email,
    subject: "NTC: Your Document Has Been Re-submitted for Review",
    html,
    text: `Hi ${displayName}, your ${formType || "document"} (${docId}) has been re-submitted for review. A translator will review it shortly.`,
  });
};

/**
 * Email: Document certified — ready for download
 */
const sendCertificationComplete = async (email, displayName, { docId, certificationId, formType }) => {
  const FRONTEND_URL = process.env.FRONTEND_URL_PROD || "https://nyotatranslate.com";

  const body = `
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">
      Hi ${escapeHtml(displayName || "there")},
    </p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">
      Great news! Your <strong>${escapeHtml(formType || "document")}</strong> has been <strong style="color:#059669;">certified</strong> by a professional translator and is ready for download.
    </p>
    <div style="background:#ecfdf5;border-radius:10px;border:1px solid #a7f3d0;padding:20px;margin:0 0 20px;text-align:center;">
      <p style="color:#059669;font-size:28px;margin:0 0 8px;">✅</p>
      <p style="color:#065f46;font-size:16px;font-weight:700;margin:0;">Certification Complete</p>
    </div>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">
      Log in to your dashboard to view and download your certified document. Your certified PDF includes a QR code for tamper-proof verification.
    </p>`;

  const html = buildBrandedEmail("Your Document is Certified! 🎓", body, {
    ctaText: "Go to My Dashboard",
    ctaUrl: `${FRONTEND_URL}/dashboard`,
  });

  return sendEmail({
    to: email,
    subject: "NTC: Your Certified Translation Is Ready",
    html,
    text: `Hi ${displayName}, great news! Your ${formType || "document"} has been certified by a professional translator. Log in to your dashboard at ${FRONTEND_URL}/dashboard to view and download it.`,
  });
};

/**
 * Email: Document rejected — needs attention
 */
const sendRejectionNotice = async (email, displayName, { docId, reason, rejectionType }) => {
  const FRONTEND_URL = process.env.FRONTEND_URL_PROD || "https://nyotatranslate.com";

  const body = `
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">
      Hi ${escapeHtml(displayName || "there")},
    </p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">
      Unfortunately, your document could not be certified at this time. Please review the feedback below.
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" style="background:#fef2f2;border-radius:10px;border:1px solid #fecaca;padding:0;margin:0 0 20px;width:100%;">
      <tr><td style="padding:14px 20px;">
        <p style="color:#991b1b;font-size:13px;margin:0 0 4px;">Reason for Rejection</p>
        <p style="color:#b91c1c;font-size:15px;font-weight:600;margin:0;">${escapeHtml(reason)}</p>
      </td></tr>
      ${rejectionType ? `<tr><td style="padding:0 20px 14px;">
        <p style="color:#991b1b;font-size:13px;margin:0 0 4px;">Category</p>
        <p style="color:#0B1120;font-size:14px;margin:0;">${escapeHtml(rejectionType)}</p>
      </td></tr>` : ""}
    </table>
    <div style="background:#fffbeb;border-radius:10px;border:1px solid #fde68a;padding:16px 20px;margin:0 0 20px;">
      <p style="color:#92400e;font-size:14px;font-weight:600;margin:0 0 8px;">💡 What you can do</p>
      <p style="color:#78350f;font-size:13px;line-height:1.6;margin:0;">
        Log in to your account and navigate to <strong>My Translations</strong> to see the rejection details.
        You can re-upload a clearer, more visible copy of your original document directly from there.
        The new image will replace the previous one for the translator to review — no need to go through the full process again.
      </p>
    </div>
    <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0;">
      If you have questions, please contact our support team.
    </p>`;

  const html = buildBrandedEmail("Document Needs Attention ⚠️", body, {
    ctaText: "Log In to Re-upload",
    ctaUrl: `${FRONTEND_URL}/translate`,
  });

  return sendEmail({
    to: email,
    subject: "NTC: Action Required, Document Review Update",
    html,
    text: `Hi ${displayName}, your document was not certified. Reason: ${reason}. Log in to your account at ${FRONTEND_URL}/translate to see the details and re-upload a better copy.`,
  });
};

/**
 * Email: New document in review queue (sent to translators)
 */
const sendNewDocumentAlert = async (email, translatorName, { docId, formType, speedTier, sourceLanguage }) => {
  const FRONTEND_URL = process.env.FRONTEND_URL_PROD || "https://nyotatranslate.com";
  const tierLabel = speedTier?.label || "Standard";

  const body = `
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">
      Hi ${escapeHtml(translatorName || "Translator")},
    </p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">
      A new document is waiting for review in the certification queue.
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" style="background:#eff6ff;border-radius:10px;border:1px solid #bfdbfe;padding:0;margin:0 0 20px;width:100%;">
      <tr><td style="padding:14px 20px;">
        <p style="color:#1e40af;font-size:13px;margin:0 0 4px;">Document Type</p>
        <p style="color:#0B1120;font-size:15px;font-weight:600;margin:0;">${escapeHtml(formType || "Document")}</p>
      </td></tr>
      <tr><td style="padding:0 20px 14px;">
        <p style="color:#1e40af;font-size:13px;margin:0 0 4px;">Language</p>
        <p style="color:#0B1120;font-size:15px;font-weight:600;margin:0;">${escapeHtml(sourceLanguage || "auto")} → en</p>
      </td></tr>
      <tr><td style="padding:0 20px 14px;">
        <p style="color:#1e40af;font-size:13px;margin:0 0 4px;">Priority</p>
        <p style="color:#e15815;font-size:15px;font-weight:700;margin:0;">${escapeHtml(tierLabel)}</p>
      </td></tr>
    </table>`;

  const html = buildBrandedEmail("New Document Awaiting Review 📋", body, {
    ctaText: "Open Review Queue",
    ctaUrl: `${FRONTEND_URL}/translator`,
  });

  return sendEmail({
    to: email,
    subject: `NTC: New ${tierLabel} Document Awaiting Your Review`,
    html,
    text: `Hi ${translatorName}, a new ${formType} document (${sourceLanguage}→en, ${tierLabel}) is waiting for review.`,
  });
};

/**
 * Email: Document claimed by translator — user notified review has started
 */
const sendDocumentClaimedNotice = async (email, displayName, { docId, formType }) => {
  const FRONTEND_URL = process.env.FRONTEND_URL_PROD || "https://nyotatranslate.com";

  const body = `
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">
      Hi ${escapeHtml(displayName || "there")},
    </p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">
      Good news! A professional translator has picked up your document and is now reviewing it.
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" style="background:#eff6ff;border-radius:10px;border:1px solid #bfdbfe;padding:0;margin:0 0 20px;width:100%;">
      <tr><td style="padding:14px 20px;">
        <p style="color:#1e40af;font-size:13px;margin:0 0 4px;">Status</p>
        <p style="color:#059669;font-size:15px;font-weight:700;margin:0;">🔍 Under Review</p>
      </td></tr>
      <tr><td style="padding:0 20px 14px;">
        <p style="color:#1e40af;font-size:13px;margin:0 0 4px;">Document Type</p>
        <p style="color:#0B1120;font-size:15px;font-weight:600;margin:0;">${escapeHtml(formType || "Document")}</p>
      </td></tr>
      <tr><td style="padding:0 20px 14px;">
        <p style="color:#1e40af;font-size:13px;margin:0 0 4px;">Reference</p>
        <p style="color:#2563eb;font-size:13px;font-family:monospace;margin:0;">${escapeHtml(docId)}</p>
      </td></tr>
    </table>
    <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0;">
      You will receive another email once the review is complete. No action is needed from you at this time.
    </p>`;

  const html = buildBrandedEmail("Your Document Is Being Reviewed 🔍", body, {
    ctaText: "View My Documents",
    ctaUrl: `${FRONTEND_URL}/dashboard`,
  });

  return sendEmail({
    to: email,
    subject: "NTC: Your Document Is Being Reviewed by a Translator",
    html,
    text: `Hi ${displayName}, a professional translator has started reviewing your ${formType || "document"} (${docId}). You'll be notified when the review is complete.`,
  });
};

// ============================================
// SUPPORT TICKET EMAIL TEMPLATES
// ============================================

/**
 * Email: Support ticket created — confirmation to user
 */
const sendTicketCreatedConfirmation = async (email, displayName, { ticketId, subject, category }) => {
  const FRONTEND_URL = process.env.FRONTEND_URL_PROD || "https://nyotatranslate.com";

  const categoryLabels = {
    document_issue: "Document Issue",
    account_issue: "Account Issue",
    payment_issue: "Payment Issue",
    translation_quality: "Translation Quality",
    technical_issue: "Technical Issue",
    general_inquiry: "General Inquiry",
    other: "Other",
  };

  const body = `
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">
      Hi ${escapeHtml(displayName || "there")},
    </p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">
      Your support ticket has been submitted successfully. Our team will review it and get back to you shortly.
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" style="background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;padding:0;margin:0 0 20px;width:100%;">
      <tr><td style="padding:14px 20px;">
        <p style="color:#6b7280;font-size:13px;margin:0 0 4px;">Subject</p>
        <p style="color:#0B1120;font-size:15px;font-weight:600;margin:0;">${escapeHtml(subject)}</p>
      </td></tr>
      <tr><td style="padding:0 20px 14px;">
        <p style="color:#6b7280;font-size:13px;margin:0 0 4px;">Category</p>
        <p style="color:#0B1120;font-size:15px;font-weight:600;margin:0;">${escapeHtml(categoryLabels[category] || category)}</p>
      </td></tr>
      <tr><td style="padding:0 20px 14px;">
        <p style="color:#6b7280;font-size:13px;margin:0 0 4px;">Ticket ID</p>
        <p style="color:#2563eb;font-size:13px;font-family:monospace;margin:0;">${escapeHtml(ticketId)}</p>
      </td></tr>
    </table>
    <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0;">
      You can track your ticket status and reply to our support team from your Help Center page.
    </p>`;

  const html = buildBrandedEmail("Support Ticket Received 🎫", body, {
    ctaText: "View My Tickets",
    ctaUrl: `${FRONTEND_URL}/help`,
  });

  return sendEmail({
    to: email,
    subject: `NTC Support: Ticket Received for ${subject}`,
    html,
    text: `Hi ${displayName}, your support ticket "${subject}" has been submitted. Ticket ID: ${ticketId}. Our team will get back to you shortly.`,
  });
};

/**
 * Email: New ticket alert — sent to support agents
 */
const sendNewTicketAlert = async (email, agentName, { ticketId, subject, category, priority, userName, userEmail }) => {
  const FRONTEND_URL = process.env.FRONTEND_URL_PROD || "https://nyotatranslate.com";

  const priorityColors = {
    low: "#059669",
    medium: "#2563eb",
    high: "#ea580c",
    urgent: "#dc2626",
  };

  const body = `
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">
      Hi ${escapeHtml(agentName || "Support Agent")},
    </p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">
      A new support ticket has been submitted and needs attention.
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" style="background:#eff6ff;border-radius:10px;border:1px solid #bfdbfe;padding:0;margin:0 0 20px;width:100%;">
      <tr><td style="padding:14px 20px;">
        <p style="color:#1e40af;font-size:13px;margin:0 0 4px;">Subject</p>
        <p style="color:#0B1120;font-size:15px;font-weight:600;margin:0;">${escapeHtml(subject)}</p>
      </td></tr>
      <tr><td style="padding:0 20px 14px;">
        <p style="color:#1e40af;font-size:13px;margin:0 0 4px;">From</p>
        <p style="color:#0B1120;font-size:15px;font-weight:600;margin:0;">${escapeHtml(userName)} (${escapeHtml(userEmail)})</p>
      </td></tr>
      <tr><td style="padding:0 20px 14px;">
        <p style="color:#1e40af;font-size:13px;margin:0 0 4px;">Priority</p>
        <p style="color:${priorityColors[priority] || "#2563eb"};font-size:15px;font-weight:700;margin:0;">${escapeHtml((priority || "medium").toUpperCase())}</p>
      </td></tr>
    </table>`;

  const html = buildBrandedEmail("New Support Ticket 🎫", body, {
    ctaText: "Open Support Dashboard",
    ctaUrl: `${FRONTEND_URL}/support`,
  });

  return sendEmail({
    to: email,
    subject: `NTC Support: New Ticket from ${subject}`,
    html,
    text: `Hi ${agentName}, a new support ticket "${subject}" from ${userName} (${userEmail}) needs attention. Priority: ${priority}. Log in to the support dashboard to respond.`,
  });
};

/**
 * Email: Ticket resolved — notification to user
 */
const sendTicketResolvedNotice = async (email, displayName, { ticketId, subject }) => {
  const FRONTEND_URL = process.env.FRONTEND_URL_PROD || "https://nyotatranslate.com";

  const body = `
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">
      Hi ${escapeHtml(displayName || "there")},
    </p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">
      Your support ticket <strong>"${escapeHtml(subject)}"</strong> has been resolved by our team.
    </p>
    <div style="background:#ecfdf5;border-radius:10px;border:1px solid #a7f3d0;padding:20px;margin:0 0 20px;text-align:center;">
      <p style="color:#059669;font-size:28px;margin:0 0 8px;">✅</p>
      <p style="color:#065f46;font-size:16px;font-weight:700;margin:0;">Ticket Resolved</p>
    </div>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">
      We'd love to hear about your experience! Please take a moment to rate our support service — your feedback helps us improve.
    </p>
    <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0;">
      If you need further assistance, feel free to create a new ticket or reply to the existing one.
    </p>`;

  const html = buildBrandedEmail("Your Ticket Has Been Resolved ✅", body, {
    ctaText: "Rate Our Service",
    ctaUrl: `${FRONTEND_URL}/help`,
  });

  return sendEmail({
    to: email,
    subject: `NTC Support: Ticket Resolved for ${subject}`,
    html,
    text: `Hi ${displayName}, your support ticket "${subject}" has been resolved. Log in to rate our service and provide feedback.`,
  });
};

/**
 * Email: Payment confirmation with invoice details
 */
const sendPaymentConfirmation = async ({ to, paymentId, amount, currency, speedTier, invoiceNumber }) => {
  const FRONTEND_URL = process.env.FRONTEND_URL_PROD || "https://nyotatranslate.com";
  const formattedAmount = `$${(amount / 100).toFixed(2)} ${(currency || "usd").toUpperCase()}`;

  const tierLabels = {
    standard: "Standard (Up to 24 hrs)",
    rush: "Rush (Up to 12 hrs)",
    express: "Express (1–5 hrs)",
  };

  const body = `
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">
      Your payment has been successfully processed. Here are the details:
    </p>
    <div style="background:#ecfdf5;border-radius:10px;border:1px solid #a7f3d0;padding:20px;margin:0 0 20px;text-align:center;">
      <p style="color:#059669;font-size:28px;margin:0 0 8px;">✅</p>
      <p style="color:#065f46;font-size:16px;font-weight:700;margin:0;">Payment Successful</p>
    </div>
    <table role="presentation" cellspacing="0" cellpadding="0" style="background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;padding:0;margin:0 0 20px;width:100%;">
      <tr><td style="padding:14px 20px;">
        <p style="color:#6b7280;font-size:13px;margin:0 0 4px;">Amount</p>
        <p style="color:#0B1120;font-size:18px;font-weight:700;margin:0;">${escapeHtml(formattedAmount)}</p>
      </td></tr>
      <tr><td style="padding:0 20px 14px;">
        <p style="color:#6b7280;font-size:13px;margin:0 0 4px;">Service</p>
        <p style="color:#0B1120;font-size:15px;font-weight:600;margin:0;">${escapeHtml(tierLabels[speedTier] || speedTier)}</p>
      </td></tr>
      ${invoiceNumber ? `<tr><td style="padding:0 20px 14px;">
        <p style="color:#6b7280;font-size:13px;margin:0 0 4px;">Invoice</p>
        <p style="color:#2563eb;font-size:13px;font-family:monospace;margin:0;">${escapeHtml(invoiceNumber)}</p>
      </td></tr>` : ""}
      <tr><td style="padding:0 20px 14px;">
        <p style="color:#6b7280;font-size:13px;margin:0 0 4px;">Payment ID</p>
        <p style="color:#2563eb;font-size:13px;font-family:monospace;margin:0;">${escapeHtml(paymentId)}</p>
      </td></tr>
    </table>
    <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0;">
      Your document has been submitted for certified translation. You can view your payment history and invoices from your dashboard.
    </p>`;

  const html = buildBrandedEmail("Payment Confirmed 💳", body, {
    ctaText: "View Payment History",
    ctaUrl: `${FRONTEND_URL}/dashboard`,
  });

  return sendEmail({
    to,
    subject: `NTC: Payment of ${formattedAmount} Confirmed`,
    html,
    text: `Payment of ${formattedAmount} confirmed for ${tierLabels[speedTier] || speedTier} translation. Payment ID: ${paymentId}`,
  });
};

module.exports = {
  sendEmail,
  sendVerificationEmail,
  sendSubmissionConfirmation,
  sendResubmissionConfirmation,
  sendCertificationComplete,
  sendRejectionNotice,
  sendNewDocumentAlert,
  sendDocumentClaimedNotice,
  sendTicketCreatedConfirmation,
  sendNewTicketAlert,
  sendTicketResolvedNotice,
  sendPaymentConfirmation,
  buildBrandedEmail,
  escapeHtml,
};

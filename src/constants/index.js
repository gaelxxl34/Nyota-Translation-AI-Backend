// Constants barrel export for NTC platform

const statuses = require("./statuses");
const languages = require("./languages");
const certificationIds = require("./certificationIds");

module.exports = {
  ...statuses,
  ...languages,
  ...certificationIds,
};

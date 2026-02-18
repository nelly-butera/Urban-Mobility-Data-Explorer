/**
 * - Small object for data quality log.
 * - We create this when we find bad or strange data.
 */
class DataIssueNote {
  constructor(dataset, recordKey, issueType, action, details) {
    this.dataset = dataset;
    this.recordKey = recordKey;
    this.issueType = issueType;
    this.action = action;
    this.details = details;
  }
}

module.exports = { DataIssueNote };

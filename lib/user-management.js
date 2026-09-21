const ALLOWED_STATUSES = new Map([
  ["active", "Active"],
  ["rejected", "Rejected"],
  ["inactive", "Inactive"]
]);

function normalizeRole(value) {
  return String(value || "USER").trim().toUpperCase() === "ADMIN"
    ? "ADMIN"
    : "USER";
}

function isAdmin(user) {
  return normalizeRole(user?.ROLE || user?.role) === "ADMIN";
}

function normalizeStatus(value) {
  return ALLOWED_STATUSES.get(String(value || "").trim().toLowerCase()) || null;
}

function buildUserPatch(input = {}) {
  const patch = {};
  const status = normalizeStatus(input.STATUS ?? input.status);

  if (status) patch.STATUS = status;

  if (input.ROLE !== undefined || input.role !== undefined) {
    patch.ROLE = normalizeRole(input.ROLE ?? input.role);
  }

  return patch;
}

module.exports = {
  ALLOWED_STATUSES,
  normalizeRole,
  isAdmin,
  normalizeStatus,
  buildUserPatch
};

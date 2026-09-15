function buildCountRows(items = [], timestamp = new Date().toISOString()) {
  if (!Array.isArray(items)) return [];

  return items
    .filter(item => {
      if (!item || typeof item !== 'object') return false;
      if (!String(item.session_id || '').trim()) return false;
      if (!String(item.movement_id || '').trim()) return false;
      if (!String(item.code || '').trim()) return false;
      if (!String(item.name || '').trim()) return false;
      if (!String(item.user || '').trim()) return false;
      return Number(item.qty) > 0;
    })
    .map(item => [
      String(item.session_id).trim(),
      String(item.movement_id).trim(),
      String(item.code).trim(),
      String(item.name).trim(),
      Number(item.qty),
      String(item.user).trim(),
      timestamp,
    ]);
}

module.exports = { buildCountRows };

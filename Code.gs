// ── Cha Nails & Spa — Google Apps Script Backend ──
//
// Sheet column layout (row 1 = header):
//   A (0) Phone | B (1) First | C (2) Last | D (3) Date | E (4) Time
//   F (5) Technician | G (6) Services | H (7) Submitted At
//
// Deploy: Extensions → Apps Script → Deploy → Manage deployments → new version
//   Execute as: Me | Who has access: Anyone

const SHEET_ID   = '1Hh5E7bdDYOylfBzAe9KTbRmqIxuY2F7q-9z0YvE0lw0';
const SHEET_NAME = 'Sheet1';

// ── Entry points ─────────────────────────────────────────────────────────────

function doGet(e) {
  // Apps Script web apps automatically include Access-Control-Allow-Origin: *
  // for GET requests when deployed as "Execute as: Me / Anyone can access".
  const action = e.parameter.action;
  if (action === 'lookup')       return lookupPhone(e.parameter.phone);
  if (action === 'availability') return checkAvailability(e.parameter.technician, e.parameter.date);
  if (action === 'book')         return bookAppointment(e.parameter);
  return json({ error: 'Unknown action' });
}

// ── Handlers ──────────────────────────────────────────────────────────────────

// GET ?action=lookup&phone=7135551234
// Returns { found, firstName, lastName } — most recent row for that phone
function lookupPhone(phone) {
  const clean = String(phone || '').replace(/\D/g, '');
  if (!clean) return json({ found: false });

  const rows  = getRows();
  let match   = null;
  for (const row of rows) {
    if (String(row[0]).replace(/\D/g, '') === clean) match = row;
  }

  if (match) return json({ found: true, firstName: match[1], lastName: match[2] });
  return json({ found: false });
}

// GET ?action=availability&technician=Bae&date=2026-04-01
// Returns { unavailableSlots: [...] } — all slots blocked by existing bookings,
// including duration + 15-min grace period for each booking.
function checkAvailability(technician, date) {
  if (!technician || !date) return json({ unavailableSlots: [] });

  const rows        = getRows();
  const unavailable = getUnavailableSlots(technician, date, rows);

  return json({ unavailableSlots: [...unavailable] });
}

// GET ?action=book&phone=&firstName=&lastName=&date=&technician=&time=&services=
// Checks for conflicts (using duration-aware blocking), then writes one row.
function bookAppointment(params) {
  const phone      = params.phone      || '';
  const firstName  = params.firstName  || '';
  const lastName   = params.lastName   || '';
  const date       = params.date       || '';
  const technician = params.technician || 'Any Tech';
  const time       = params.time       || '';
  const services   = params.services   || '';

  const rows        = getRows();
  const unavailable = getUnavailableSlots(technician, date, rows);

  if (unavailable.has(time)) {
    const next = findNextAvailable(technician, date, time, rows);
    return json({
      success:       false,
      conflict:      true,
      nextAvailable: next,
      error:         technician + ' is not available at ' + time + '.',
    });
  }

  const sheet = getSheet();
  ensureHeader(sheet);
  sheet.appendRow([phone, firstName, lastName, date, time, technician, services, new Date().toISOString()]);
  return json({ success: true });
}

// ── Duration-aware slot blocking ──────────────────────────────────────────────

// Returns a Set of all time strings that are unavailable for technician+date,
// accounting for service duration + 15-min grace period on each booking.
function getUnavailableSlots(technician, date, rows) {
  const isAny      = technician === 'Any Tech';
  const unavailable = new Set();

  for (const row of rows) {
    if (String(row[3]) !== date) continue;
    const rowTech = String(row[5]);
    if (!isAny && rowTech !== 'Any Tech' && rowTech !== technician) continue;

    const rowTime     = String(row[4]);
    const rowServices = String(row[6]);
    const blocked     = getBlockedSlots(rowTime, rowServices);
    blocked.forEach(s => unavailable.add(s));
  }

  return unavailable;
}

// Returns all 15-min slots occupied by a booking:
// from start time up to (but not including) start + duration + 15-min grace.
function getBlockedSlots(startTime, servicesStr) {
  const totalMin  = parseTotalDuration(servicesStr) + 15;
  const startMin  = timeToMinutes(startTime);
  const blocked   = [];

  for (const slot of allTimeSlots()) {
    const slotMin = timeToMinutes(slot);
    if (slotMin >= startMin && slotMin < startMin + totalMin) {
      blocked.push(slot);
    }
  }

  return blocked;
}

// Parses "Full Set 45min, Pedicure 45min" → 90
function parseTotalDuration(servicesStr) {
  const matches = String(servicesStr).match(/(\d+)min/g) || [];
  const total   = matches.reduce((sum, m) => sum + parseInt(m, 10), 0);
  return total > 0 ? total : 15;
}

// ── Next-available helper ─────────────────────────────────────────────────────

function findNextAvailable(technician, date, requestedTime, rows) {
  const unavailable = getUnavailableSlots(technician, date, rows);
  const reqMin      = timeToMinutes(requestedTime);

  for (const slot of allTimeSlots()) {
    if (timeToMinutes(slot) <= reqMin) continue;
    if (!unavailable.has(slot)) return slot;
  }

  return null;
}

// ── Time helpers ──────────────────────────────────────────────────────────────

function allTimeSlots() {
  const slots = [];
  for (let h = 9; h <= 21; h++) {
    for (let m = 0; m < 60; m += 15) {
      if (h === 21 && m > 0) break;
      const ampm = h < 12 ? 'AM' : 'PM';
      const hour = h % 12 === 0 ? 12 : h % 12;
      const min  = m === 0 ? '00' : String(m);
      slots.push(hour + ':' + min + ' ' + ampm);
    }
  }
  return slots;
}

function timeToMinutes(timeStr) {
  try {
    const parts = String(timeStr).split(' ');
    const ampm  = parts[1];
    const hm    = parts[0].split(':');
    let   h     = parseInt(hm[0], 10);
    const m     = parseInt(hm[1], 10);
    if (ampm === 'PM' && h !== 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return h * 60 + m;
  } catch (_) { return 0; }
}

// ── Sheet helpers ─────────────────────────────────────────────────────────────

function getSheet() {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME)
      || SpreadsheetApp.openById(SHEET_ID).getActiveSheet();
}

function getRows() {
  const sheet = getSheet();
  const vals  = sheet.getDataRange().getValues();
  return vals.slice(1).filter(r => r[0] !== '' && String(r[0]).toLowerCase() !== 'phone');
}

function ensureHeader(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Phone','First Name','Last Name','Date','Time','Technician','Services','Submitted At']);
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

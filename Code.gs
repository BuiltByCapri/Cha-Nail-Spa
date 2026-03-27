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
// Returns { found, firstName, lastName } — uses most recent row for that phone
function lookupPhone(phone) {
  const clean = String(phone || '').replace(/\D/g, '');
  if (!clean) return json({ found: false });

  const rows  = getRows();
  let match   = null;
  for (const row of rows) {
    if (String(row[0]).replace(/\D/g, '') === clean) match = row; // keep last match
  }

  if (match) return json({ found: true, firstName: match[1], lastName: match[2] });
  return json({ found: false });
}

// GET ?action=availability&technician=Bae&date=2026-04-01
// Returns { bookedTimes: ['10:00 AM', ...] } for that tech+date combo.
function checkAvailability(technician, date) {
  if (!technician || !date) return json({ bookedTimes: [] });

  const rows        = getRows();
  const bookedTimes = [];
  const isAny       = technician === 'Any Tech';

  for (const row of rows) {
    const rowDate = String(row[3]);
    const rowTime = String(row[4]);
    const rowTech = String(row[5]);
    if (rowDate !== date) continue;
    if (isAny || rowTech === 'Any Tech' || rowTech === technician) {
      if (rowTime) bookedTimes.push(rowTime);
    }
  }

  return json({ bookedTimes });
}

// GET ?action=book&phone=&firstName=&lastName=&date=&technician=&time=&services=
// Conflict-checks first; if blocked returns nextAvailable slot.
// Writes a single row if clean.
function bookAppointment(params) {
  const phone      = params.phone      || '';
  const firstName  = params.firstName  || '';
  const lastName   = params.lastName   || '';
  const date       = params.date       || '';
  const technician = params.technician || 'Any Tech';
  const time       = params.time       || '';
  const services   = params.services   || '';

  const rows  = getRows();
  const isAny = technician === 'Any Tech';

  // ── Conflict check ──
  for (const row of rows) {
    const rowDate = String(row[3]);
    const rowTime = String(row[4]);
    const rowTech = String(row[5]);
    if (rowDate !== date || rowTime !== time) continue;

    if (isAny || rowTech === 'Any Tech' || rowTech === technician) {
      const nextAvailable = findNextAvailable(technician, date, time, rows);
      return json({
        success:       false,
        conflict:      true,
        nextAvailable: nextAvailable,
        error:         technician + ' is already booked at ' + time + '.',
      });
    }
  }

  // ── Write row ──
  const sheet = getSheet();
  ensureHeader(sheet);
  sheet.appendRow([phone, firstName, lastName, date, time, technician, services, new Date().toISOString()]);
  return json({ success: true });
}

// ── Next-available helper ─────────────────────────────────────────────────────

function findNextAvailable(technician, date, requestedTime, rows) {
  const isAny  = technician === 'Any Tech';
  const booked = new Set();

  for (const row of rows) {
    if (String(row[3]) !== date) continue;
    const rowTech = String(row[5]);
    if (isAny || rowTech === 'Any Tech' || rowTech === technician) {
      booked.add(String(row[4]));
    }
  }

  const slots      = allTimeSlots();
  const reqMinutes = timeToMinutes(requestedTime);

  for (const slot of slots) {
    if (timeToMinutes(slot) <= reqMinutes) continue; // skip requested time and earlier
    if (!booked.has(slot)) return slot;
  }

  return null; // fully booked for the day
}

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

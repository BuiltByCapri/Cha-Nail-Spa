// ── Cha Nails & Spa — Google Apps Script Backend ──
//
// Sheet column layout (row 1 = header):
//   A (0) Phone | B (1) First | C (2) Last | D (3) Date | E (4) Time
//   F (5) Technician | G (6) Services | H (7) Submitted At
//
// Deploy: Extensions → Apps Script → Deploy → New deployment → Web app
//   Execute as: Me | Who has access: Anyone

const SHEET_ID   = '1Hh5E7bdDYOylfBzAe9KTbRmqIxuY2F7q-9z0YvE0lw0';
const SHEET_NAME = 'Sheet1';

// ── Entry points ────────────────────────────────────────────────────────────

function doGet(e) {
  // Apps Script web apps automatically include Access-Control-Allow-Origin: *
  // for GET requests when deployed as "Execute as: Me / Anyone can access".
  // No manual header setting needed — ContentService handles it.
  const action = e.parameter.action;
  if (action === 'lookup')       return lookupPhone(e.parameter.phone);
  if (action === 'availability') return checkAvailability(e.parameter.technician, e.parameter.date);
  if (action === 'book')         return bookFromParams(e.parameter);
  return json({ error: 'Unknown action' });
}

// Handles booking submitted as GET params (browser no-cors workaround)
function bookFromParams(p) {
  return bookAppointment({
    phone:      p.phone     || '',
    firstName:  p.firstName || '',
    lastName:   p.lastName  || '',
    date:       p.date      || '',
    appointments: [{
      technician: p.technician || 'Any Tech',
      time:       p.time       || '',
      services:   (p.services  || '').split(', ').filter(Boolean),
    }],
  });
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.action === 'book') return bookAppointment(data);
    return json({ error: 'Unknown action' });
  } catch (err) {
    return json({ error: err.message });
  }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

// GET ?action=lookup&phone=7135551234
// Returns { found, first, last } — uses the most recent row for that phone
function lookupPhone(phone) {
  const clean = String(phone || '').replace(/\D/g, '');
  if (!clean) return json({ found: false });

  const rows  = getRows();
  let match   = null;

  for (const row of rows) {
    if (String(row[0]).replace(/\D/g, '') === clean) match = row; // keep last
  }

  if (match) return json({ found: true, firstName: match[1], lastName: match[2] });
  return json({ found: false });
}

// GET ?action=availability&technician=Bae&date=2026-04-01
// Returns { bookedTimes: ['10:00 AM', ...] } for that tech+date combo.
// "Any Tech" bookings block all specific techs on that slot, and vice-versa.
function checkAvailability(technician, date) {
  if (!technician || !date) return json({ bookedTimes: [] });

  const rows       = getRows();
  const bookedTimes = [];
  const isAny       = technician === 'Any Tech';

  for (const row of rows) {
    const rowDate = String(row[3]);
    const rowTime = String(row[4]);
    const rowTech = String(row[5]);
    if (rowDate !== date) continue;

    // Conflict if: same specific tech, OR either side is "Any Tech"
    const conflicts = isAny || rowTech === 'Any Tech' || rowTech === technician;
    if (conflicts && rowTime) bookedTimes.push(rowTime);
  }

  return json({ bookedTimes });
}

// POST { action:'book', phone, firstName, lastName, date, appointments:[{services,technician,time}] }
// Checks for conflicts first; writes all rows if clean.
function bookAppointment(data) {
  const rows = getRows();

  // ── Conflict check ──
  for (const appt of (data.appointments || [])) {
    const reqTech = appt.technician || 'Any Tech';
    const reqTime = appt.time || '';
    const reqDate = data.date || '';

    for (const row of rows) {
      const rowDate = String(row[3]);
      const rowTime = String(row[4]);
      const rowTech = String(row[5]);
      if (rowDate !== reqDate || rowTime !== reqTime) continue;

      const isAnyReq = reqTech === 'Any Tech';
      const isAnyRow = rowTech === 'Any Tech';
      if (isAnyReq || isAnyRow || rowTech === reqTech) {
        return json({
          conflict: true,
          message:  `${reqTech} is already booked at ${reqTime} on ${formatDate(reqDate)}.`,
        });
      }
    }
  }

  // ── Write rows ──
  const sheet = getSheet();
  ensureHeader(sheet);
  const now = new Date().toISOString();

  for (const appt of (data.appointments || [])) {
    sheet.appendRow([
      data.phone     || '',
      data.firstName || '',
      data.lastName  || '',
      data.date      || '',
      appt.time      || '',
      appt.technician|| '',
      (appt.services || []).join(', '),
      now,
    ]);
  }

  return json({ success: true });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getSheet() {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME)
      || SpreadsheetApp.openById(SHEET_ID).getActiveSheet();
}

function getRows() {
  const sheet = getSheet();
  const vals  = sheet.getDataRange().getValues();
  // Skip header row (row 0) and any rows where col A looks like a header label
  return vals.slice(1).filter(r => r[0] !== '' && String(r[0]).toLowerCase() !== 'phone');
}

function ensureHeader(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Phone','First Name','Last Name','Date','Time','Technician','Services','Submitted At']);
  }
}

function formatDate(dateStr) {
  try {
    const [y, m, d] = dateStr.split('-');
    const months = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
    return `${months[parseInt(m,10)-1]} ${parseInt(d,10)}, ${y}`;
  } catch (_) { return dateStr; }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

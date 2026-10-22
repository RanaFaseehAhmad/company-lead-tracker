/**
 * Prototype implementation of improved CSV cell escaping and row formatting
 */

function escapeCsvCell(val, { isIdentifier = false, isPhone = false } = {}) {
  if (val === null || val === undefined) return '""';

  let str;
  if (typeof val === 'boolean') {
    str = val ? 'Yes' : 'No';
  } else if (Array.isArray(val)) {
    str = val.map(item => (typeof item === 'object' ? JSON.stringify(item) : String(item))).join(', ');
  } else if (typeof val === 'object') {
    try {
      str = JSON.stringify(val);
    } catch {
      str = String(val);
    }
  } else {
    str = String(val);
  }

  // Preserve leading zeros for phone numbers in Excel
  if (isPhone && /^0\d+/.test(str)) {
    str = `'${str}`;
  }

  // Preserve IDs as text in Excel so scientific notation is avoided
  if (isIdentifier && (/^\d+$/.test(str) || /^\d+[eE]\d+$/.test(str))) {
    str = `'${str}`;
  }

  // Neutralize spreadsheet formula execution triggers (CWE-1236)
  // Triggers: =, +, -, @, \t, \r
  if (/^[=+\-@\t\r]/.test(str) && !str.startsWith("'")) {
    str = `'${str}`;
  }

  // RFC 4180: If contains quotes, commas, carriage returns, or newlines, quote and double inner quotes
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

// Test cases
console.log('1. Normal text:', escapeCsvCell('Jane Doe'));
console.log('2. Commas and quotes:', escapeCsvCell('Acme, Inc. "Global Partners"'));
console.log('3. Formula =cmd:', escapeCsvCell("=cmd|' /C calc'!A0"));
console.log('4. Formula +AWS:', escapeCsvCell('+AWS-Enterprise'));
console.log('5. Formula @User:', escapeCsvCell('@MaliciousUser'));
console.log('6. Formula -2+5:', escapeCsvCell('-2+5*9 formula trigger'));
console.log('7. Phone with +:', escapeCsvCell('+1-555-0199', { isPhone: true }));
console.log('8. Phone with 0:', escapeCsvCell('0712345678', { isPhone: true }));
console.log('9. Multiline text:', escapeCsvCell('Line 1\nLine 2\r\nLine 3'));
console.log('10. Boolean true:', escapeCsvCell(true));
console.log('11. Boolean false:', escapeCsvCell(false));
console.log('12. Array:', escapeCsvCell(['Option A', 'Option B']));
console.log('13. Empty:', escapeCsvCell(''));
console.log('14. Null:', escapeCsvCell(null));
console.log('15. Unicode:', escapeCsvCell('München Tech 🚀'));

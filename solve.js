// solve.js — a fast drop-in for csv-reader 1.0.0 (make.fun csv-reader-speed-01).
//
// run(input) returns exactly csv-reader 1.0.0's answer for {text, header}:
// {columns, rows, errors}. The text is read once, left to right, with commas and
// double quotes; a U+FEFF at its very start is dropped; a record ends at LF or CRLF
// and a line left with no characters is no record; outside quotes a CR not followed
// by LF is dropped (stray_cr); a field that opens with a quote runs to the next
// quote that is not doubled ("" inside it one quote, each CRLF or lone CR inside it
// read as LF); what follows its closing quote, up to the next comma or line break,
// is appended as it stands (quote_junk, when the field ends); a quote that never
// closes is a literal character and the text after it is read again as unquoted
// (unterminated_quote); a quote inside an unquoted field is a literal character;
// fields stay strings, never trimmed or converted; columns is the first record when
// header is true, else null; rows holds the records after it, each padded with ""
// (short_row) or cut (long_row) to the first record's width; each error is
// {code, line, row}, in the order met, line the 1-based line its record starts on.
//
// Speed comes from never looping character by character: a quote-free line is one
// slice plus a native split(','), an unquoted field is the nearer of the next comma
// / line break found by indexOf, and a quoted field is scanned chunk by chunk with
// indexOf('"'). Only the rare broken pieces (stray CRs, newlines inside quotes)
// take a closer look. Pure: no clock, no randomness, no locale, nothing kept from
// one call to the next.

/** How a field ended: at a comma, at a line break, or at the end of the text. */
const COMMA = 'comma';
const LINE_BREAK = 'line break';
const END = 'end';

/** csv-reader 1.0.0's answer for one case's input, {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR
  // not followed by LF is dropped (stray_cr). Returns the field and how it ended;
  // `added` counts the characters kept.
  function readUnquoted(value) {
    let added = 0;
    const c = text.indexOf(',', pos);
    const n = text.indexOf('\n', pos);
    let end;
    let ended;
    if (c === -1 && n === -1) {
      end = len;
      ended = END;
    } else if (n === -1 || (c !== -1 && c < n)) {
      end = c;
      ended = COMMA;
    } else {
      end = n;
      ended = LINE_BREAK;
    }
    let chunk = text.slice(pos, end);
    if (chunk.indexOf('\r') !== -1) {
      // Drop every stray CR (each one an error); a CR at the very end of a chunk
      // that ends at a line break is that break's CRLF, not a stray CR.
      let v = '';
      let s = 0;
      for (;;) {
        const r = chunk.indexOf('\r', s);
        if (r === -1) {
          v += chunk.slice(s);
          break;
        }
        if (ended === LINE_BREAK && r === chunk.length - 1) {
          v += chunk.slice(s, r);
          break;
        }
        v += chunk.slice(s, r);
        error('stray_cr');
        s = r + 1;
      }
      chunk = v;
    }
    value += chunk;
    added += chunk.length;
    pos = end;
    if (ended === COMMA) {
      pos += 1;
      return { value, ended: COMMA, added };
    }
    if (ended === LINE_BREAK) {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK, added };
    }
    return { value, ended: END, added };
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    let closed = false;
    while (pos < len) {
      const q = text.indexOf('"', pos);
      if (q === -1) break;
      let chunk = text.slice(pos, q);
      if (chunk.indexOf('\r') !== -1 || chunk.indexOf('\n') !== -1) {
        // CRLF and a lone CR inside quotes are each one LF.
        chunk = chunk.replace(/\r\n?/g, '\n');
        let nl = 0;
        for (let i = 0; i < chunk.length; i++) if (chunk.charCodeAt(i) === 10) nl += 1;
        line += nl;
      }
      if (q + 1 < len && text.charCodeAt(q + 1) === 34) {
        value += chunk;
        value += '"';
        pos = q + 2;
        continue;
      }
      value += chunk;
      pos = q + 1;
      closed = true;
      break;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text after it
      // is read again as unquoted.
      pos = open + 1;
      line = openLine;
      error('unterminated_quote');
      return readUnquoted('"');
    }
    if (pos >= len) return { value, ended: END };
    const cc = text.charCodeAt(pos);
    if (cc === 44) {
      pos += 1;
      return { value, ended: COMMA };
    }
    if (cc === 10) {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    if (cc === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    // What follows the closing quote is appended as it stands, up to the next
    // comma or line break.
    const junk = readUnquoted(value);
    if (junk.added > 0) error('quote_junk');
    return junk;
  }

  // Reads one record (which may span lines through a quoted field) starting at
  // pos, and returns its fields plus whether its last field was quoted.
  function readRecord() {
    const fields = [];
    let quoted = false;
    let field;
    do {
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        field = readQuoted();
      } else {
        quoted = false;
        field = readUnquoted('');
      }
      fields.push(field.value);
    } while (field.ended === COMMA);
    return { fields, quoted };
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const cc = text.charCodeAt(pos);
      if (cc === 10) {
        pos += 1;
        line += 1;
      } else if (cc === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: the line holds no quote, so the whole record is one slice plus
    // a native split, unless a stray CR hides in it (then the record goes
    // through the field reader instead).
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? len : nl;
    const qi = text.indexOf('"', pos);
    let fields;
    let quoted;
    if (qi === -1 || qi >= end) {
      const cri = text.indexOf('\r', pos);
      if (cri === -1 || cri >= end) {
        fields = text.slice(pos, end).split(',');
        quoted = false;
        pos = nl === -1 ? len : nl + 1;
        line += 1;
      } else if (nl !== -1 && cri === end - 1) {
        // The only CR is the trailing one of a CRLF ending: strip it.
        fields = text.slice(pos, end - 1).split(',');
        quoted = false;
        pos = nl + 1;
        line += 1;
      } else {
        const rec = readRecord();
        fields = rec.fields;
        quoted = rec.quoted;
      }
    } else {
      const rec = readRecord();
      fields = rec.fields;
      quoted = rec.quoted;
    }

    // A line that held only stray CRs is left with no characters: no record (its
    // stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}

/* Un classeur .xlsx ecrit a la main.

   Le client a demande un vrai fichier Excel, pas un CSV : avec du francais
   accentue et de l arabe dans les memes colonnes, un CSV s ouvre de travers
   une fois sur deux selon la version d Excel et la langue de Windows. Un
   .xlsx porte son encodage et ses formats avec lui.

   Un .xlsx est une archive ZIP contenant du XML. Il n y a pas de dependance
   installable dans ce deploiement — pas de node_modules du tout — donc le
   ZIP est assemble ici : zlib fait la compression, le reste est l en-tete.

   Volontairement minimal : une feuille, une ligne d en-tete en gras, et
   trois formats (texte, montant, date). Assez pour un releve mensuel.     */

const zlib = require('zlib');

/* ── ZIP ─────────────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* Excel lit la date MS-DOS des entrees ; une date fixe et valide suffit et
   rend le fichier reproductible. */
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

function zip(files) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = Buffer.from(f.data, 'utf8');
    const data = zlib.deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            /* version needed */
    local.writeUInt16LE(0x0800, 6);        /* bit 11 : noms en UTF-8 */
    local.writeUInt16LE(8, 8);             /* deflate */
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);              /* version made by */
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(DOS_TIME, 12);
    dir.writeUInt16LE(DOS_DATE, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(0, 38);              /* attributs externes */
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);

    offset += local.length + name.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([Buffer.concat(locals), centralBuf, end]);
}

/* ── XML ─────────────────────────────────────────────────────────────── */

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    /* Excel refuse d ouvrir un fichier contenant un caractere de controle */
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function colName(i) {
  let s = '';
  i += 1;
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

/* Excel compte les jours depuis le 1900-01-00, avec le bug du 29 fevrier
   1900 qu il faut reproduire : d ou le +2 plutot que +1. */
function excelDate(iso) {
  const ms = Date.parse(iso);
  if (!isFinite(ms)) return null;
  return ms / 86400000 + 25569;
}

const STYLE = { text: 0, head: 1, money: 2, date: 3 };

function sheetXml(columns, rows) {
  const widths = columns.map((c, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${c.width || 16}" customWidth="1"/>`).join('');

  const head = columns.map((c, i) =>
    `<c r="${colName(i)}1" s="${STYLE.head}" t="inlineStr"><is><t xml:space="preserve">${esc(c.label)}</t></is></c>`).join('');

  const body = rows.map((row, r) => {
    const cells = columns.map((c, i) => {
      const ref = `${colName(i)}${r + 2}`;
      const v = row[c.key];
      if (v == null || v === '') return '';
      if (c.type === 'money' || c.type === 'number') {
        const n = Number(v);
        if (!isFinite(n)) return '';
        return `<c r="${ref}" s="${c.type === 'money' ? STYLE.money : STYLE.text}"><v>${n}</v></c>`;
      }
      if (c.type === 'date') {
        const d = excelDate(v);
        if (d == null) return '';
        return `<c r="${ref}" s="${STYLE.date}"><v>${d}</v></c>`;
      }
      return `<c r="${ref}" s="${STYLE.text}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('');
    return `<row r="${r + 2}">${cells}</row>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><outlinePr/></sheetPr>
<cols>${widths}</cols>
<sheetData><row r="1">${head}</row>${body}</sheetData>
</worksheet>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2">
<numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;$&quot;"/>
<numFmt numFmtId="165" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/>
</numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFE9DC"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
</styleSheet>`;

/* columns: [{ key, label, type?: 'text'|'money'|'number'|'date', width? }] */
function workbook(sheetName, columns, rows) {
  const name = String(sheetName || 'Feuille').replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31);
  return zip([
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${esc(name)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` },
    { name: 'xl/styles.xml', data: STYLES_XML },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml(columns, rows) },
  ]);
}

module.exports = { workbook };

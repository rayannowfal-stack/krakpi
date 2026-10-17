// Turns an Excel (.xlsx), Word (.docx), CSV or text file into plain text that Claude can read.
// (Photos and PDFs are read by Claude directly.) Uses JSZip, which comes with the PowerPoint library.
import JSZip from "jszip";

const MAX = 60000; // characters sent to Claude per file
const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");
const textOf = (xml) => decode(xml.replace(/<[^>]+>/g, ""));

export const kindOfFile = (name, type) => {
  const n = String(name || "").toLowerCase();
  if (/\.xlsx$/.test(n) || /spreadsheetml/.test(type || "")) return "xlsx";
  if (/\.docx$/.test(n) || /wordprocessingml/.test(type || "")) return "docx";
  if (/\.(csv|txt|tsv)$/.test(n) || /^text\//.test(type || "")) return "text";
  if (/\.xls$|\.doc$/.test(n)) return "old";
  if (/\.pdf$/.test(n) || type === "application/pdf") return "pdf";
  if (/^image\//.test(type || "") || /\.(jpe?g|png|webp|gif|heic)$/.test(n)) return "photo";
  return "other";
};

/** Column letters → number: A=1, Z=26, AA=27 */
const colNum = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };

async function xlsxText(buf) {
  const zip = await JSZip.loadAsync(buf);
  const shared = [];
  const ss = zip.file("xl/sharedStrings.xml");
  if (ss) { const x = await ss.async("string"); for (const m of x.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, ""))); }
  const wb = await zip.file("xl/workbook.xml")?.async("string") || "";
  const names = [...wb.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => decode(m[1]));
  const sheets = Object.keys(zip.files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)).sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
  let out = "";
  for (let i = 0; i < sheets.length && out.length < MAX; i++) {
    const x = await zip.file(sheets[i]).async("string");
    out += `\n=== Sheet: ${names[i] || "Sheet" + (i + 1)} ===\n`;
    for (const row of x.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const c of row[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1]; const body = c[2] || "";
        const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1]; const t = (attrs.match(/t="(\w+)"/) || [])[1];
        let v = "";
        if (t === "s") v = shared[+((body.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || -1)] ?? "";
        else if (t === "inlineStr") v = textOf((body.match(/<is>([\s\S]*?)<\/is>/) || [])[1] || "");
        else v = decode((body.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || "");
        if (!v) { const f = (body.match(/<f>([\s\S]*?)<\/f>/) || [])[1]; if (f) v = "=" + decode(f); }
        if (ref) cells[colNum(ref) - 1] = v.replace(/[\r\n\t]+/g, " ").trim();
      }
      if (cells.some((v) => v)) out += Array.from(cells, (v) => v ?? "").join(" | ") + "\n";
      if (out.length > MAX) break;
    }
  }
  return out.trim();
}
async function docxText(buf) {
  const zip = await JSZip.loadAsync(buf);
  const x = await zip.file("word/document.xml")?.async("string") || "";
  return textOf(x.replace(/<w:tab\/>/g, "\t").replace(/<\/w:p>\s*<\/w:tc>/g, " | ").replace(/<\/w:tc>/g, " | ").replace(/<\/w:tr>/g, "\n").replace(/<\/w:p>/g, "\n").replace(/<w:br\/>/g, "\n")).replace(/ \| \n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Returns { kind, text } — text is "" for photos/PDFs (Claude reads those itself). Throws a friendly error for old formats. */
export async function readForClaude(file) {
  const kind = kindOfFile(file.name, file.type);
  if (kind === "old") throw new Error(`${file.name}: old .xls / .doc format — please save it as .xlsx / .docx (or PDF) and upload again.`);
  if (kind === "photo" || kind === "pdf") return { kind, text: "" };
  const buf = await file.arrayBuffer();
  let text = "";
  if (kind === "xlsx") text = await xlsxText(buf);
  else if (kind === "docx") text = await docxText(buf);
  else if (kind === "text") text = new TextDecoder().decode(buf);
  else throw new Error(`${file.name}: this file type can't be read. Use Excel (.xlsx), Word (.docx), PDF or a photo.`);
  return { kind, text: text.slice(0, MAX) };
}

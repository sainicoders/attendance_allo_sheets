/**
 * PDF attendance sheet generator using pdfmake.
 */

const CANDIDATES_PER_PAGE = 8;
const GRAY = "#D3D3D3";
const RED = "#CC0000";
const NAVY = "#1a3a6b";
const BORDER = [true, true, true, true];
const ORG_NAME_LINES = [
  "HIGH COURT OF JAMMU & KASHMIR AND LADAKH",
];

let logoDataUrl = null;
const imageCache = new Map();
let imagesFailed = false;

async function loadLogo() {
  if (logoDataUrl) return logoDataUrl;
  try {
    const resp = await fetch("assets/jammu-logo.png");
    if (!resp.ok) throw new Error("Fetch PNG failed");
    const blob = await resp.blob();
    logoDataUrl = await blobToDataUrl(blob);
  } catch (err) {
    console.error("Failed to load jammu logo, trying SVG fallback", err);
    try {
      const resp = await fetch("nfl/logo.svg");
      if (!resp.ok) throw new Error("Fetch SVG failed");
      const svgText = await resp.text();
      logoDataUrl = await svgToPngDataUrl(svgText, 308, 266);
    } catch (fallbackErr) {
      console.error("Logo fallback failed", fallbackErr);
    }
  }
  return logoDataUrl;
}

function svgToPngDataUrl(svgText, width, height) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const timer = setTimeout(() => {
      URL.revokeObjectURL(url);
      reject(new Error("SVG logo timeout"));
    }, 5000);

    img.onload = () => {
      clearTimeout(timer);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      try {
        resolve(canvas.toDataURL("image/png"));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = (err) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function resizeImageBlob(blob, maxW, maxH) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    const timer = setTimeout(() => {
      URL.revokeObjectURL(url);
      resolve(null);
    }, 5000);

    img.onload = () => {
      clearTimeout(timer);
      let w = img.width;
      let h = img.height;
      const scale = Math.min(maxW / w, maxH / h, 1);
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

async function fetchImageAsDataUrl(url, maxW = 120, maxH = 140) {
  if (!url) return null;
  if (imageCache.has(url)) {
    return imageCache.get(url);
  }

  let resolveSlot;
  const pending = new Promise((r) => {
    resolveSlot = r;
  });
  imageCache.set(url, pending);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const proxyUrl = `/api/image?url=${encodeURIComponent(url)}`;
    const resp = await fetch(proxyUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) throw new Error("fetch failed");
    const blob = await resp.blob();
    const dataUrl = (await resizeImageBlob(blob, maxW, maxH)) || (await blobToDataUrl(blob));
    imageCache.set(url, dataUrl);
    resolveSlot(dataUrl);
    return dataUrl;
  } catch {
    imagesFailed = true;
    imageCache.set(url, null);
    resolveSlot(null);
    return null;
  }
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;

  async function run() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

async function preloadCandidateImages(candidates, onProgress) {
  imagesFailed = false;
  const jobs = [];
  for (const c of candidates) {
    if (c.photo) jobs.push({ url: c.photo, maxW: 100, maxH: 120 });
    if (c.signature) jobs.push({ url: c.signature, maxW: 140, maxH: 70 });
  }

  let done = 0;
  await mapPool(jobs, 4, async (job) => {
    await fetchImageAsDataUrl(job.url, job.maxW, job.maxH);
    done += 1;
    if (onProgress) onProgress(done, jobs.length);
  });
  return !imagesFailed;
}

function grayCell(text, options = {}) {
  return {
    text,
    fillColor: GRAY,
    bold: true,
    fontSize: options.fontSize || 7,
    alignment: options.alignment || "center",
    margin: options.margin || [2, 3, 2, 3],
  };
}

function emptyBox(height = 40) {
  return { text: " ", fontSize: 1, margin: [2, height / 2, 2, height / 2] };
}

function imageOrBox(dataUrl, width, height) {
  if (dataUrl) {
    return { image: dataUrl, width, height, alignment: "center", margin: [2, 2, 2, 2] };
  }
  return { text: " ", fontSize: 1, margin: [2, height / 2, 2, height / 2], border: BORDER };
}

function buildHeader(settings, sheetTitle) {
  const logo = logoDataUrl
    ? { image: logoDataUrl, width: 62, height: 62, alignment: "center", margin: [2, 4, 2, 4] }
    : { text: "", width: 60 };

  const orgStack = ORG_NAME_LINES.map((line, idx) => ({
    text: line,
    color: NAVY,
    bold: true,
    fontSize: 13,
    alignment: "center",
    margin: [0, idx === 0 ? 4 : 0, 0, idx === ORG_NAME_LINES.length - 1 ? 6 : 1],
  }));

  return {
    table: {
      widths: [74, "*"],
      body: [
        [
          logo,
          {
            stack: [
              ...orgStack,
              {
                text: settings.centerName || "",
                bold: true,
                fontSize: 9,
                alignment: "center",
                margin: [0, 0, 0, 3],
              },
              {
                text: sheetTitle || "ATTENDANCE SHEET",
                bold: true,
                fontSize: 11,
                alignment: "center",
                decoration: "underline",
                margin: [0, 0, 0, 2],
              },
            ],
          },
        ],
      ],
    },
    layout: {
      hLineWidth: () => 1,
      vLineWidth: () => 1,
      hLineColor: () => "#000",
      vLineColor: () => "#000",
    },
    margin: [0, 0, 0, 6],
  };
}

function buildMetaRow(settings) {
  const examDateStr = formatExamDate(settings.examDate, settings.shift);
  return {
    table: {
      widths: [65, 55, 75, 75, 65, "*"],
      body: [
        [
          grayCell("CITY CODE", { alignment: "left", fontSize: 8 }),
          { text: settings.cityCode || "", fontSize: 9, alignment: "center", margin: [0, 3, 0, 3] },
          grayCell("CENTER CODE", { alignment: "left", fontSize: 8 }),
          { text: settings.centerCode || "", fontSize: 9, alignment: "center", margin: [0, 3, 0, 3] },
          grayCell("EXAM DATE", { alignment: "left", fontSize: 8 }),
          { text: examDateStr, fontSize: 8, alignment: "center", margin: [0, 3, 0, 3] }
        ]
      ]
    },
    layout: {
      hLineWidth: () => 1,
      vLineWidth: () => 1,
      hLineColor: () => "#000",
      vLineColor: () => "#000",
    },
    margin: [0, 0, 0, 4],
  };
}

function formatExamDate(dateStr, shift) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const formatted = `${String(d.getDate()).padStart(2, "0")} ${months[d.getMonth()]} ${d.getFullYear()}`;
  if (shift) return `${formatted} (Shift-${shift})`;
  return formatted;
}

function fieldRow(label, value) {
  return {
    columns: [
      { text: label, bold: true, fontSize: 7, width: 42, margin: [2, 1, 0, 1] },
      { text: value || "", fontSize: 8, margin: [0, 1, 2, 1] },
    ],
  };
}

function buildCandidateRow(candidate) {
  const photoUrl = imageCache.get(candidate.photo);
  const sigUrl = imageCache.get(candidate.signature);

  return {
    table: {
      widths: [95, 52, 75, 75, "*"],
      body: [
        [
          {
            stack: [
              grayCell("CANDIDATE PARTICULARS", { fontSize: 7 }),
              fieldRow("NAME", candidate.candidateName),
              fieldRow("ROLL NO", candidate.rollNo),
              fieldRow("LOGIN ID", candidate.applicationId),
            ],
            border: BORDER,
          },
          {
            stack: [imageOrBox(photoUrl, 50, 58)],
            border: BORDER,
          },
          {
            stack: [
              grayCell("CANDIDATE\nSCANNED\nSIGNATURE", { fontSize: 6 }),
              imageOrBox(sigUrl, 68, 32),
            ],
            border: BORDER,
          },
          {
            stack: [
              grayCell("CANDIDATE\nSIGNATURE", { fontSize: 6 }),
              emptyBox(36),
            ],
            border: BORDER,
          },
         {
  table: {
    widths: [70, "*"],
    body: [
      [
        grayCell("OMR NO.", {
          alignment: "left",
          fontSize: 7,
        }),
        { text: "", margin: [2, 4, 2, 4] },
      ],
      [
        grayCell("TEST BOOKLET SERIES", {
          alignment: "left",
          fontSize: 6,
        }),
        { text: "", margin: [2, 4, 2, 4] },
      ],
      [
        grayCell("TEST BOOKLET NO.", {
          alignment: "left",
          fontSize: 6,
        }),
        { text: "", margin: [2, 4, 2, 4] },
      ],
    ],
  },
  layout: {
    hLineWidth: () => 1,
    vLineWidth: () => 1,
    hLineColor: () => "#000",
    vLineColor: () => "#000",
  },
  border: BORDER,
}
        ],
      ],
    },
    layout: {
      hLineWidth: () => 0.8,
      vLineWidth: () => 0.8,
      hLineColor: () => "#000",
      vLineColor: () => "#000",
      paddingLeft: (i) => i === 4 ? 0 : 4,
      paddingRight: (i) => i === 4 ? 0 : 4,
      paddingTop: (i) => i === 4 ? 0 : 4,
      paddingBottom: (i) => i === 4 ? 0 : 4,
    },
    margin: [0, 0, 0, 2],
  };
}

function buildFooter(total) {
  return {
    table: {
      widths: [80, 80, 80, "*", "*", 90],
      body: [
        [
          { stack: [grayCell("TOTAL", { fontSize: 7 }), emptyBox(16)], border: BORDER },
          { stack: [grayCell("PRESENT", { fontSize: 7 }), emptyBox(16)], border: BORDER },
          { stack: [grayCell("ABSENT", { fontSize: 7 }), emptyBox(16)], border: BORDER },
          {
            stack: [
              grayCell("INVIGILATOR NAME", { fontSize: 7, alignment: "left" }),
              emptyBox(16),
            ],
            border: BORDER,
          },
          {
            stack: [
              grayCell("INV. MOBILE No.", { fontSize: 7, alignment: "left" }),
              emptyBox(16),
            ],
            border: BORDER,
          },
          {
            stack: [grayCell("INV. SIGN.", { fontSize: 7 }), emptyBox(16)],
            border: BORDER,
          },
        ],
      ],
    },
    layout: {
      hLineWidth: () => 1,
      vLineWidth: () => 1,
      hLineColor: () => "#000",
      vLineColor: () => "#000",
    },
    margin: [0, 20, 0, 0],
    pageBreak: "avoid",
  };
}

function buildPageContent(
  pageCandidates,
  settings,
  pageNum,
  totalPages,
  totalCandidates,
  isLastPage
) {

  const content = [
    {
      text: `Page ${pageNum} of ${totalPages} pages`,
      alignment: "right",
      fontSize: 8,
      margin: [0, 0, 0, 4],
    },
    buildHeader(settings),
    buildMetaRow(settings),
  ];

  for (const c of pageCandidates) {
    content.push(
      buildCandidateRow(c)
    );
  }

const footer = buildFooter(totalCandidates);

if (isLastPage) {
  footer.table.body[0][0].stack[1] = {
    text: String(totalCandidates),
    fontSize: 10,
    alignment: "center",
    margin: [0, 4, 0, 0],
  };
}

content.push(footer);

  return content;
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  if (!chunks.length) chunks.push([]);
  return chunks;
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/_+/g, "_");
}

async function generateRoomPdf(assignment, settings, onProgress) {
  await loadLogo();
  await preloadCandidateImages(assignment.candidates, (done, total) => {
    if (onProgress) onProgress(`Loading images ${done}/${total}…`);
  });

  if (onProgress) onProgress("Building PDF…");

  const candidates = assignment.candidates;
  const pages = chunkArray(candidates, CANDIDATES_PER_PAGE);
  const totalPages = pages.length || 1;
  const content = [];

  pages.forEach((pageCandidates, idx) => {
    if (idx > 0) content.push({ text: "", pageBreak: "before" });
    const pageContent = buildPageContent(
      pageCandidates,
      settings,
      idx + 1,
      totalPages,
      candidates.length,
      idx === pages.length - 1
    );
    content.push(...pageContent);
  });

  const docDefinition = {
    pageSize: "A4",
    pageMargins: [28, 28, 28, 28],
    defaultStyle: { font: "Roboto" },
    content,
  };

  return new Promise((resolve, reject) => {
    try {
      const pdf = pdfMake.createPdf(docDefinition);
      pdf.getBlob((blob) => resolve(blob));
    } catch (err) {
      reject(err);
    }
  });
}

function roomPdfFilename(centerCode, room) {
  const label = sanitizeFilename(room.label || `Packet${room.packetNo}`);
  return `${centerCode}_Packet${String(room.packetNo).padStart(2, "0")}_${label}.pdf`;
}

function didImagesFail() {
  return imagesFailed;
}

function resetImageState() {
  imagesFailed = false;
}

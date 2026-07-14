#!/usr/bin/env node
/**
 * Convert Excel files in data/ into clean JSON files.
 */

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const DATA = path.join(__dirname, "..", "data");

function cleanStr(v) {
  if (v == null) return "";
  return String(v)
    .replace(/\r\n/g, " ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function excelSerialToDate(serial) {
  if (serial === "" || serial == null) return "";
  if (typeof serial === "string" && /\d{1,2}[-\/]/.test(serial)) return serial;
  const n = Number(serial);
  if (!Number.isFinite(n) || n < 1) return String(serial);
  const utc = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(utc);
  if (isNaN(d.getTime())) return String(serial);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function parseCapacity(v) {
  if (v === "" || v == null) return 0;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  const mul = s.match(/^(\d+)\s*[x*]\s*(\d+)$/i);
  if (mul) return Number(mul[1]) * Number(mul[2]);
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  const nums = s.match(/\d+/g);
  if (!nums) return 0;
  return Number(nums[nums.length - 1]);
}

function writeJson(filename, data) {
  const out = path.join(DATA, filename);
  fs.writeFileSync(out, JSON.stringify(data, null, 2), "utf8");
  console.log(`Wrote ${out}`);
  return out;
}

function convertJammuCentres() {
  const wb = XLSX.readFile(path.join(DATA, "jammu.xlsx"));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["Centers List"], { defval: "" });
  const centres = rows.map((r) => ({
    sNo: Number(r["S.No."]) || 0,
    centreCode: Number(r["Centre code"]) || 0,
    name: cleanStr(r["Name of Centre"]),
    seatingCapacity: Number(r["Seating Capacity"]) || 0,
    address: cleanStr(r["Address"]),
  }));
  writeJson("jammu-centres.json", centres);
  console.log(`  ${centres.length} centres`);
}

function convertSrinagarCentres() {
  const wb = XLSX.readFile(path.join(DATA, "Sringar Final centre list 2026.xlsx"));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["Table 1"], { defval: "" });
  const seatingKey = Object.keys(rows[0] || {}).find((k) => k.includes("Seating"));

  const centres = rows.map((r) => ({
    sNo: Number(r["S.No"]) || 0,
    centreCode: Number(r["Centre Code"]) || 0,
    name: cleanStr(r["Name Of The Institute"]),
    address: cleanStr(r["Address Of Centre"]),
    hoiName: cleanStr(r["Name Of The HOI"]),
    contactNo: cleanStr(r["Contact No"]),
    email: cleanStr(r["Email Of Centre"]).replace(/\s+/g, ""),
    seatingCapacity: seatingKey ? Number(r[seatingKey]) || 0 : 0,
  }));
  writeJson("srinagar-centres.json", centres);
  console.log(`  ${centres.length} centres`);
}

function convertSrinagarRooms() {
  const wb = XLSX.readFile(path.join(DATA, "Final Sringar centre list.xlsx"));
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
    defval: "",
  });

  const centres = [];
  let current = null;
  let inTable = false;

  for (const row of raw) {
    const a = row[0];
    const aStr = cleanStr(a);
    const emptyRow =
      !aStr && !cleanStr(row[1]) && !cleanStr(row[2]) && !cleanStr(row[3]) && !cleanStr(row[4]);
    if (emptyRow) continue;
    if (/^DISTRICT/i.test(aStr)) continue;

    const headerMatch = aStr.match(/^(\d+)\.\s*(.+)$/);
    if (headerMatch && !/^S\.?No/i.test(aStr)) {
      current = {
        sNo: Number(headerMatch[1]),
        name: cleanStr(headerMatch[2]),
        rooms: [],
        totalCapacity: 0,
      };
      centres.push(current);
      inTable = false;
      continue;
    }

    if (/^S\.?No/i.test(aStr)) {
      inTable = true;
      continue;
    }

    if (/^Total Capacity of Centre/i.test(aStr)) {
      if (current) {
        current.totalCapacity = Number(row[4]) || Number(row[3]) || 0;
      }
      inTable = false;
      continue;
    }

    if (inTable && current && (typeof a === "number" || /^\d+$/.test(aStr))) {
      const capRaw = row[4];
      current.rooms.push({
        sNo: Number(a),
        block: cleanStr(row[1]),
        floor: cleanStr(row[2]),
        room: cleanStr(row[3]),
        capacity: parseCapacity(capRaw),
        capacityRaw: cleanStr(capRaw),
      });
    }
  }

  writeJson("srinagar-rooms.json", centres);
  const roomCount = centres.reduce((n, c) => n + c.rooms.length, 0);
  console.log(`  ${centres.length} centres, ${roomCount} rooms`);
}

function convertJammuRooms() {
  const wb = XLSX.readFile(path.join(DATA, "JAMMU SEATING PLAN SHEET 1.xlsx"));
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
    defval: "",
  });

  const centres = [];
  let current = null;
  let inTable = false;

  for (const row of raw) {
    const cells = row.map(cleanStr);
    const a = cells[0];
    const joined = cells.join(" ").trim();
    if (!joined) continue;

    const headerMatch = a.match(/^(\d+)\s*[-–]\s*(.+)$/);
    if (headerMatch) {
      current = {
        sNo: Number(headerMatch[1]),
        name: cleanStr(headerMatch[2]),
        rooms: [],
        totalCapacity: 0,
      };
      centres.push(current);
      inTable = false;
      continue;
    }

    if (/^S\.?NO/i.test(a)) {
      inTable = true;
      continue;
    }

    const totalIdx = cells.findIndex((c) => /^total\s*$/i.test(c));
    if (totalIdx >= 0) {
      const cap = Number(cells[totalIdx + 1]) || Number(cells[4]) || 0;
      if (current) current.totalCapacity = cap;
      inTable = false;
      continue;
    }

    if (inTable && current) {
      if (/^\d+$/.test(a)) {
        current.rooms.push({
          sNo: Number(a),
          block: cells[1],
          floor: cells[2],
          room: cells[3],
          capacity: parseCapacity(cells[4]),
          capacityRaw: cells[4],
        });
      } else if (!a && (cells[3] || cells[4]) && !/^total/i.test(cells[3])) {
        current.rooms.push({
          sNo: current.rooms.length + 1,
          block: cells[1],
          floor: cells[2],
          room: cells[3],
          capacity: parseCapacity(cells[4]),
          capacityRaw: cells[4],
        });
      }
    }
  }

  writeJson("jammu-rooms.json", centres);
  const roomCount = centres.reduce((n, c) => n + c.rooms.length, 0);
  console.log(`  ${centres.length} centres, ${roomCount} rooms`);
}

function convertCandidates() {
  console.log("Reading J&S final.xlsx (large)...");
  const wb = XLSX.readFile(path.join(DATA, "J&S final.xlsx"));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["Sheet1"], { defval: "" });

  const candidates = rows.map((r) => ({
    sNo: Number(r["S.No."]) || 0,
    rollNo: cleanStr(r["Roll No."]),
    centreCode: Number(r["Centre Code"]) || 0,
    centreName: cleanStr(r["Centre Name"]),
    centreAddress: cleanStr(r["Centre Address"]),
    postName: cleanStr(r["Post Name"]),
    registrationNumber: cleanStr(r["Registration Number"]),
    candidateName: cleanStr(r["Candidate name"]),
    fatherName: cleanStr(r["Father Name"]),
    motherName: cleanStr(r["Mother Name"]),
    dateOfBirth: excelSerialToDate(r["Date of Birth"]),
    gender: cleanStr(r["Gender"]),
    category: cleanStr(r["Category"]),
    email: cleanStr(r["Email"]),
    examCity: cleanStr(r["Exam City"]),
    pwd: cleanStr(r["PWD"]),
    city: cleanStr(r["City"]),
    state: cleanStr(r["State"]),
    pincode: cleanStr(r["Pincode"]),
    srinagarSNo: r["Srinagar S.No."] === "" ? null : Number(r["Srinagar S.No."]),
    jammuSNo: r["Jammu S.No."] === "" ? null : Number(r["Jammu S.No."]),
    photoUrl: cleanStr(r["PHOTO_URL"]),
    signUrl: cleanStr(r["SIGN_URL"]),
  }));

  writeJson("candidates-js-final.json", candidates);
  console.log(`  ${candidates.length} candidates`);
  console.log(`  Sample DOB: ${candidates[0]?.dateOfBirth}, ${candidates[1]?.dateOfBirth}`);
}

function main() {
  console.log("Converting Excel files in data/ to JSON...\n");
  convertJammuCentres();
  convertSrinagarCentres();
  convertSrinagarRooms();
  convertJammuRooms();
  convertCandidates();
  console.log("\nDone.");
}

main();

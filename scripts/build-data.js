#!/usr/bin/env node
/**
 * Build js/data.js and data/candidates.json from Jammu/Srinagar JSON exports.
 */

const fs = require("fs");
const path = require("path");

const BASE = path.join(__dirname, "..");
const DATA = path.join(BASE, "data");

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8"));
}

function normalizeRooms(roomCentre) {
  const rows = roomCentre.rooms || [];
  const total = Number(roomCentre.totalCapacity) || 0;
  const sumCap = rows.reduce((n, r) => n + (Number(r.capacity) || 0), 0);

  let useMultiply = false;
  if (total > 0 && Math.abs(sumCap - total) > 5) {
    const sumMul = rows.reduce((n, r) => {
      const count = Number(r.room);
      const cap = Number(r.capacity) || 0;
      if (Number.isFinite(count) && count > 0 && count <= 40 && cap > 0) {
        return n + count * cap;
      }
      return n + cap;
    }, 0);
    if (Math.abs(sumMul - total) <= 5) useMultiply = true;
  }

  const packets = [];
  let packetNo = 0;

  for (const r of rows) {
    const cap = Number(r.capacity) || 0;
    const count = Number(r.room);
    const block = r.block || "";
    const floor = r.floor || "";

    if (useMultiply && Number.isFinite(count) && count > 0 && count <= 40 && cap > 0) {
      for (let i = 1; i <= count; i++) {
        packetNo += 1;
        packets.push({
          packetNo,
          block,
          floor,
          room: String(i),
          label: [block, floor, `R${i}`].filter(Boolean).join(" / "),
          capacity: cap,
        });
      }
      continue;
    }

    // Expand 24*N style into N packets of 24 when capacity matches
    const mulMatch = String(r.room || r.capacityRaw || "").match(/^(\d+)\s*[x*]\s*(\d+)$/i);
    if (mulMatch) {
      const per = Number(mulMatch[1]);
      const n = Number(mulMatch[2]);
      if (per > 0 && n > 0 && (!cap || Math.abs(per * n - cap) <= 2 || cap === n || cap === per)) {
        const seats = cap && cap >= per * n ? Math.round(cap / n) : per;
        for (let i = 1; i <= n; i++) {
          packetNo += 1;
          packets.push({
            packetNo,
            block,
            floor,
            room: String(i),
            label: [block, floor, `R${i}`].filter(Boolean).join(" / "),
            capacity: seats,
          });
        }
        continue;
      }
    }

    packetNo += 1;
    const roomLabel = String(r.room || packetNo);
    packets.push({
      packetNo,
      block,
      floor,
      room: roomLabel,
      label: [block, floor, roomLabel].filter(Boolean).join(" / ") || `Packet ${packetNo}`,
      capacity: cap || 24,
    });
  }

  // If still short of total capacity, bump last packet
  if (total > 0) {
    const sum = packets.reduce((n, p) => n + p.capacity, 0);
    if (sum < total && packets.length) {
      packets[packets.length - 1].capacity += total - sum;
    }
  }

  return packets;
}

function buildCenters() {
  const jammuCentres = readJson("jammu-centres.json").filter((c) => c.centreCode > 0);
  const srinagarCentres = readJson("srinagar-centres.json").filter((c) => c.centreCode > 0);
  const jammuRooms = readJson("jammu-rooms.json");
  const srinagarRooms = readJson("srinagar-rooms.json");

  const centers = [];

  function addCity(centres, roomsBySNo, city, cityCodeDefault) {
    for (const c of centres) {
      const roomCentre = roomsBySNo.get(c.sNo);
      const rooms = roomCentre
        ? normalizeRooms(roomCentre)
        : [
            {
              packetNo: 1,
              block: "",
              floor: "",
              room: "1",
              label: "Main",
              capacity: c.seatingCapacity || 24,
            },
          ];

      centers.push({
        id: String(c.centreCode),
        name: c.name,
        displayName: `${c.centreCode} — ${c.name} (${city})`,
        city,
        cityCodeDefault,
        address: c.address || "",
        seatingCapacity: c.seatingCapacity || 0,
        rooms,
      });
    }
  }

  addCity(
    srinagarCentres,
    new Map(srinagarRooms.map((r) => [r.sNo, r])),
    "Srinagar",
    "SRN"
  );
  addCity(
    jammuCentres,
    new Map(jammuRooms.map((r) => [r.sNo, r])),
    "Jammu",
    "JMU"
  );

  return centers;
}

function buildCandidates() {
  const raw = readJson("candidates-js-final.json");
  return raw.map((c) => ({
    applicationId: String(c.registrationNumber || c.sNo),
    registrationNo: String(c.registrationNumber || ""),
    rollNo: String(c.rollNo || ""),
    candidateName: String(c.candidateName || "").toUpperCase(),
    fatherName: String(c.fatherName || "").toUpperCase(),
    motherName: String(c.motherName || "").toUpperCase(),
    dob: String(c.dateOfBirth || ""),
    category: String(c.category || ""),
    gender: String(c.gender || ""),
    centerCode: String(c.centreCode || ""),
    centerName: String(c.centreName || ""),
    centerAddress: String(c.centreAddress || ""),
    photo: String(c.photoUrl || ""),
    signature: String(c.signUrl || ""),
    examCity: String(c.examCity || ""),
    postApplied: String(c.postName || ""),
    email: String(c.email || ""),
  }));
}

function main() {
  console.log("Building HCJKL attendance data from data/*.json ...");

  const centers = buildCenters();
  const candidates = buildCandidates();

  // Ensure each center has enough seats for its candidates (overflow → last room)
  const byCenter = new Map();
  for (const c of candidates) {
    byCenter.set(c.centerCode, (byCenter.get(c.centerCode) || 0) + 1);
  }
  let warnings = 0;
  for (const center of centers) {
    const roomCap = center.rooms.reduce((n, r) => n + r.capacity, 0);
    const candCount = byCenter.get(center.id) || 0;
    if (candCount > roomCap && center.rooms.length) {
      const extra = candCount - roomCap;
      center.rooms[center.rooms.length - 1].capacity += extra;
      warnings += 1;
      console.log(
        `  Adjusted ${center.id}: +${extra} seats on last room (${candCount} candidates)`
      );
    }
  }
  if (!warnings) console.log("  All centers have enough room seats for assigned candidates.");

  const candOut = path.join(DATA, "candidates.json");
  fs.writeFileSync(candOut, JSON.stringify(candidates, null, 2), "utf8");
  console.log(`Wrote ${candOut} (${candidates.length} candidates)`);

  const dataOut = path.join(BASE, "js", "data.js");
  const examDates = [
    { value: "2026-07-19", label: "19 Jul 2026" },
  ];
  fs.writeFileSync(
    dataOut,
    `const CENTERS = ${JSON.stringify(centers, null, 2)};\n\n` +
      `const EXAM_DATES = ${JSON.stringify(examDates, null, 2)};\n`,
    "utf8"
  );
  console.log(`Wrote ${dataOut} (${centers.length} centers, ${examDates.length} exam dates)`);
}

main();

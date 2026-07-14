/**
 * Attendance Sheet Generator — main application logic.
 */

let candidates = [];
let currentAssignments = [];

const els = {
  center: document.getElementById("center"),
  room: document.getElementById("room"),
  examDate: document.getElementById("examDate"),
  cityCode: document.getElementById("cityCode"),
  centerCode: document.getElementById("centerCode"),
  summary: document.getElementById("summary"),
  notice: document.getElementById("notice"),
  downloadBtn: document.getElementById("downloadBtn"),
  allocationBtn: document.getElementById("allocationBtn"),
  status: document.getElementById("status"),
};

async function init() {
  bindEvents();

  els.status.textContent = "Loading candidate data…";
  try {
    const resp = await fetch("data/candidates.json");
    candidates = await resp.json();
    els.status.textContent = `Loaded ${candidates.length.toLocaleString()} candidates.`;

    populateCenters();
    populateExamDates();
    onCenterChange();
  } catch (err) {
    els.status.textContent =
      "Failed to load candidates.json. Run: npm install && npm start";
    console.error(err);
  }
}

function populateCenters() {
  els.center.innerHTML = CENTERS.map(
    (c) => `<option value="${c.id}">${c.displayName}</option>`
  ).join("");
}

function populateExamDates() {
  const dates =
    typeof EXAM_DATES !== "undefined" && EXAM_DATES.length
      ? EXAM_DATES
      : [{ value: "2026-07-19", label: "19 Jul 2026" }];

  els.examDate.innerHTML = dates
    .map((d) => `<option value="${d.value}">${d.label}</option>`)
    .join("");
  els.examDate.value = dates[0].value;
}

function getSelectedCenter() {
  return CENTERS.find((c) => c.id === els.center.value);
}

function buildAssignmentsForCenter(center) {
  if (!center || !center.rooms || !center.rooms.length) return [];
  return allocateCandidatesToRooms(candidates, center.id, center.rooms);
}

function onCenterChange() {
  const center = getSelectedCenter();
  if (!center) return;

  els.centerCode.value = center.id;
  els.cityCode.value = center.cityCodeDefault;

  currentAssignments = buildAssignmentsForCenter(center);

  els.room.innerHTML =
    `<option value="all">All Rooms (ZIP)</option>` +
    currentAssignments
      .map(({ room, candidates: roomCands }) => {
        const count = roomCands ? roomCands.length : 0;
        return `<option value="${room.packetNo}">Packet ${room.packetNo} — ${room.label} (${count}/${room.capacity})</option>`;
      })
      .join("");

  updateSummary();
}

function onRoomChange() {
  updateSummary();
}

function getSelectedAssignment() {
  const packetNo = parseInt(els.room.value, 10);
  if (isNaN(packetNo)) return null;
  return getRoomAssignment(currentAssignments, packetNo);
}

function updateSummary() {
  const center = getSelectedCenter();
  if (!center) return;

  const isAll = els.room.value === "all";
  let html = `<p><strong>Center:</strong> ${center.name}</p>`;
  html += `<p><strong>City:</strong> ${center.city || "—"}</p>`;

  if (isAll) {
    const total = currentAssignments.reduce(
      (n, a) => n + (a.candidates ? a.candidates.length : 0),
      0
    );
    html += `<p><strong>Rooms:</strong> ${currentAssignments.length}</p>`;
    html += `<p><strong>Candidates assigned:</strong> ${total}</p>`;
  } else {
    const assignment = getSelectedAssignment();
    if (assignment) {
      const { room, candidates: roomCands } = assignment;
      html += `<p><strong>Room:</strong> ${room.label}</p>`;
      html += `<p><strong>Packet No.:</strong> ${room.packetNo}</p>`;
      html += `<p><strong>Capacity:</strong> ${room.capacity}</p>`;
      html += `<p><strong>Candidates assigned:</strong> ${roomCands ? roomCands.length : 0}</p>`;
      html += `<p><strong>Roll range:</strong> ${getRollRange(roomCands || [])}</p>`;
    }
  }

  els.summary.innerHTML = html;
}

function getSettings(center) {
  return {
    centerCode: center.id,
    centerName: center.name,
    cityCode: center.cityCodeDefault || els.cityCode.value.trim(),
    examDate: els.examDate.value,
  };
}

function validateSettings() {
  if (!els.examDate.value) {
    alert("Please select an exam date.");
    return false;
  }
  if (!els.cityCode.value.trim()) {
    alert("Please enter a city code.");
    return false;
  }
  return true;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function setBusy(busy) {
  els.downloadBtn.disabled = busy;
  els.allocationBtn.disabled = busy;
}

async function onDownload() {
  if (!validateSettings()) return;
  if (!candidates.length) {
    alert("Candidate data not loaded.");
    return;
  }

  const center = getSelectedCenter();
  if (!center) {
    alert("Please select a center.");
    return;
  }

  setBusy(true);
  els.notice.textContent = "";
  resetImageState();

  try {
    const settings = getSettings(center);
    if (els.room.value === "all") {
      await downloadAllRooms(center, settings);
    } else {
      const assignment = getSelectedAssignment();
      if (!assignment || !assignment.candidates.length) {
        alert("No candidates assigned to this room.");
        return;
      }
      els.status.textContent = "Generating PDF…";
      const blob = await generateRoomPdf(assignment, settings, (msg) => {
        els.status.textContent = msg;
      });
      const filename = roomPdfFilename(center.id, assignment.room);
      downloadBlob(blob, filename);
      els.status.textContent = `Downloaded ${filename}`;
    }

    if (didImagesFail()) {
      els.notice.textContent =
        "Note: Some candidate photos/signatures could not be embedded. Layout and text fields are complete.";
    }
  } catch (err) {
    console.error(err);
    els.status.textContent = "Error generating PDF.";
    alert("Failed to generate PDF. See console for details.");
  } finally {
    setBusy(false);
  }
}

async function downloadAllRooms(center, settings) {
  const archive = new JSZip();
  const total = currentAssignments.length;
  let done = 0;

  for (const assignment of currentAssignments) {
    if (!assignment.candidates.length) continue;
    done++;
    els.status.textContent = `Generating ${center.id} room ${done} of ${total}…`;
    const blob = await generateRoomPdf(assignment, settings, (msg) => {
      els.status.textContent = `${center.id} (${done}/${total}): ${msg}`;
    });
    const filename = roomPdfFilename(center.id, assignment.room);
    archive.file(filename, blob);
  }

  els.status.textContent = "Creating ZIP archive…";
  const zipBlob = await archive.generateAsync({ type: "blob" });
  downloadBlob(zipBlob, `${center.id}_All_Rooms_Attendance.zip`);
  els.status.textContent = `Downloaded ZIP with ${done} attendance sheets.`;
}

async function onDownloadAllocation() {
  if (!validateSettings()) return;

  const center = getSelectedCenter();
  if (!center) {
    alert("Please select a center.");
    return;
  }

  setBusy(true);
  try {
    els.status.textContent = "Generating room allocation sheet…";
    const blob = await generateRoomAllocationPdf(
      currentAssignments,
      getSettings(center)
    );
    downloadBlob(blob, `${center.id}_Room_Allocation_Sheet.pdf`);
    els.status.textContent = `Downloaded ${center.id}_Room_Allocation_Sheet.pdf`;
  } catch (err) {
    console.error(err);
    alert("Failed to generate allocation PDF.");
  } finally {
    setBusy(false);
  }
}

function bindEvents() {
  els.center.addEventListener("change", onCenterChange);
  els.room.addEventListener("change", onRoomChange);
  els.examDate.addEventListener("change", updateSummary);
  els.downloadBtn.addEventListener("click", onDownload);
  els.allocationBtn.addEventListener("click", onDownloadAllocation);
}

document.addEventListener("DOMContentLoaded", init);

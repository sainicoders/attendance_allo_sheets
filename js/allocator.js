/**
 * Assign candidates to rooms by roll number order and room capacity.
 */

// function sortByRollNo(candidates) {
//   return [...candidates].sort((a, b) => {
//     const ra = parseInt(a.rollNo, 10);
//     const rb = parseInt(b.rollNo, 10);
//     if (!isNaN(ra) && !isNaN(rb) && ra !== rb) return ra - rb;
//     return String(a.rollNo).localeCompare(String(b.rollNo));
//   });
// }
// function sortByRollNo(candidates) {
//   return [...candidates].sort((a, b) => {
//     const rollA = String(a.rollNo || "");
//     const rollB = String(b.rollNo || "");

//     // Last 4 digits only
//     const seqA = parseInt(rollA.slice(-4), 10);
//     const seqB = parseInt(rollB.slice(-4), 10);

//     return seqA - seqB;
//   });
// }
function sortByRollNo(candidates) {
  return [...candidates].sort((a, b) => {
    const ra = Number(a.rollNo);
    const rb = Number(b.rollNo);

    if (!Number.isNaN(ra) && !Number.isNaN(rb)) {
      return ra - rb;
    }

    return String(a.rollNo).localeCompare(String(b.rollNo));
  });
}
function filterByCenter(candidates, centerCode) {
  return candidates.filter((c) => c.centerCode === centerCode);
}

/**
 * @param {object[]} candidates - all candidates
 * @param {string} centerCode
 * @param {object[]} rooms - room config from CENTERS
 * @returns {{ room: object, candidates: object[] }[]}
 */
function allocateCandidatesToRooms(candidates, centerCode, rooms) {
  const filtered = sortByRollNo(filterByCenter(candidates, centerCode));
  let offset = 0;
  const assignments = [];

  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i];
    const isLast = i === rooms.length - 1;
    const end = isLast ? filtered.length : offset + room.capacity;
    const slice = filtered.slice(offset, end);
    assignments.push({ room, candidates: slice });
    offset = end;
  }

  return assignments;
}

function getRoomAssignment(assignments, packetNo) {
  return assignments.find((a) => a.room.packetNo === packetNo) || null;
}

function getRollRange(candidates) {
  if (!candidates.length) return "—";
  const sorted = sortByRollNo(candidates);
  return `${sorted[0].rollNo} – ${sorted[sorted.length - 1].rollNo}`;
}

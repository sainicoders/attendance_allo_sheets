async function generateRoomAllocationPdf(
  assignments,
  settings
) {
  await loadLogo();

  const body = [
    [
      grayCell("Packet"),
      grayCell("Block"),
      grayCell("Floor"),
      grayCell("Room"),
      grayCell("Roll From"),
      grayCell("Roll To"),
      grayCell("Total")
    ]
  ];

  assignments.forEach(a => {
    if (!a.candidates.length) return;

    body.push([
      String(a.room.packetNo),
      a.room.block || "",
      a.room.floor || "",
      a.room.room || a.room.label,
      a.candidates[0]?.rollNo || "",
      a.candidates[a.candidates.length - 1]?.rollNo || "",
      String(a.candidates.length)
    ]);
  });

  const docDefinition = {
    pageSize: "A4",
    pageOrientation: "landscape",

  pageMargins: [10, 15, 10, 15],

    content: [
      buildHeader(settings, "ROOM ALLOCATION SHEET"),

      buildMetaRow(settings),

      {
        table: {
          headerRows: 1,
        widths: [
  "8%",
  "22%",
  "10%",
  "20%",
  "15%",
  "15%",
  "10%"
],
          body
        },

        layout: {
          hLineWidth: () => 1,
          vLineWidth: () => 1,
          hLineColor: () => "#000",
          vLineColor: () => "#000"
        }
      }
    ]
  };

  return new Promise((resolve, reject) => {
    try {
      const pdf =
        pdfMake.createPdf(docDefinition);

      pdf.getBlob(blob => resolve(blob));
    } catch (err) {
      reject(err);
    }
  });
}
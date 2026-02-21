/* ellipse.js (Firetube-style layout + IDs)
   Inputs: idLong, idShort, cs
   Outputs: OD calculated automatically
   DXF Layers: Perimeter (OD), Holes (ID)
*/

(() => {
  const $ = (id) => document.getElementById(id);

  const idLongEl = $("idLong");
  const idShortEl = $("idShort");
  const csEl = $("cs");

  const validateBtn = $("validateBtn");
  const statusEl = $("status");

  const canvas = $("preview");
  const filenameEl = $("filename");
  const downloadBtn = $("downloadBtn");

  let lastValid = null;

  function parseInches(str) {
    if (str == null) return NaN;
    let s = String(str).trim();
    if (!s) return NaN;

    s = s.replace(/-/g, " ").replace(/\s+/g, " ");

    const parts = s.split(" ");

    // "a b/c"
    if (parts.length === 2 && parts[1].includes("/")) {
      const whole = Number(parts[0]);
      const [n, d] = parts[1].split("/").map(Number);
      if (!Number.isFinite(whole) || !Number.isFinite(n) || !Number.isFinite(d) || d === 0) return NaN;
      return whole + n / d;
    }

    // "b/c"
    if (parts.length === 1 && s.includes("/")) {
      const [n, d] = s.split("/").map(Number);
      if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return NaN;
      return n / d;
    }

    const v = Number(s);
    return Number.isFinite(v) ? v : NaN;
  }

  function fmt(x, digits = 3) {
    if (!Number.isFinite(x)) return "—";
    let s = x.toFixed(digits);
    s = s.replace(/\.?0+$/, "");
    return s;
  }

  // ------- Canvas -------
  function prepCanvas() {
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const cssW = rect.width || canvas.width || 860;
    const cssH = rect.height || canvas.height || 420;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    return { ctx, w: cssW, h: cssH };
  }

  function clear(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
  }

  function crosshair(ctx, w, h) {
    const cx = w / 2, cy = h / 2;
    ctx.strokeStyle = "#e9e9e9";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, cy); ctx.lineTo(w, cy);
    ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
    ctx.stroke();
  }

  function drawPreview(idL, idS, odL, odS) {
    const { ctx, w, h } = prepCanvas();
    clear(ctx, w, h);
    crosshair(ctx, w, h);

    if (![idL, idS, odL, odS].every(Number.isFinite)) return;

    const pad = 22;
    const scale = Math.min((w - 2 * pad) / odL, (h - 2 * pad) / odS);
    const cx = w / 2, cy = h / 2;

    // OD
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, (odL / 2) * scale, (odS / 2) * scale, 0, 0, Math.PI * 2);
    ctx.stroke();

    // ID
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.ellipse(cx, cy, (idL / 2) * scale, (idS / 2) * scale, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ------- DXF (R12 polyline approximation) -------
  function dxfHeader() {
    return [
      "0","SECTION","2","HEADER",
      "9","$ACADVER","1","AC1009",
      "9","$INSUNITS","70","1",
      "0","ENDSEC",
      "0","SECTION","2","TABLES",
      "0","TABLE","2","LAYER","70","2",
      "0","LAYER","2","Perimeter","70","0","62","7","6","CONTINUOUS",
      "0","LAYER","2","Holes","70","0","62","7","6","CONTINUOUS",
      "0","ENDTAB",
      "0","ENDSEC",
      "0","SECTION","2","ENTITIES"
    ].join("\n") + "\n";
  }

  function dxfFooter() {
    return ["0","ENDSEC","0","EOF"].join("\n");
  }

  function ellipsePoints(longDia, shortDia, segments = 260) {
    const a = longDia / 2;
    const b = shortDia / 2;
    const pts = [];
    for (let i = 0; i < segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      pts.push([a * Math.cos(t), b * Math.sin(t)]);
    }
    return pts;
  }

  function dxfPolyline(points, layer, closed = true) {
    const out = [];
    out.push("0","POLYLINE","8",layer,"66","1","70", closed ? "1" : "0","10","0","20","0","30","0");
    for (const [x, y] of points) {
      out.push("0","VERTEX","8",layer,"10",String(x),"20",String(y),"30","0");
    }
    out.push("0","SEQEND");
    return out.join("\n") + "\n";
  }

  function downloadTextFile(filename, text) {
    const blob = new Blob([text], { type: "application/dxf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ------- Logic -------
  function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.style.color = isError ? "#b91c1c" : "";
  }

  function setDownloadEnabled(enabled) {
  downloadBtn.disabled = !enabled;

  if (enabled) {
    downloadBtn.classList.remove("disabled");
    downloadBtn.textContent = "Download DXF File";
  } else {
    downloadBtn.classList.add("disabled");
    downloadBtn.textContent = "Enter CAD Name to Download";
  }
}

  function validateAndPreview() {
    const idL = parseInches(idLongEl.value);
    const idS = parseInches(idShortEl.value);
    const cs = parseInches(csEl.value);

    const errors = [];
    if (!Number.isFinite(idL) || idL <= 0) errors.push("Long Side ID must be a positive number.");
    if (!Number.isFinite(idS) || idS <= 0) errors.push("Short Side ID must be a positive number.");
    if (!Number.isFinite(cs) || cs <= 0) errors.push("Cross Section must be a positive number.");
    if (Number.isFinite(idL) && Number.isFinite(idS) && idS > idL) errors.push("Short Side ID cannot be larger than Long Side ID.");

    if (errors.length) {
      lastValid = null;
      setStatus("ERRORS: " + errors.join(" "), true);
      drawPreview(NaN, NaN, NaN, NaN);
      setDownloadEnabled(false);
      return;
    }

    const odL = idL + 2 * cs;
    const odS = idS + 2 * cs;

    lastValid = { idL, idS, cs, odL, odS };

    setStatus(`OK — ID ${fmt(idL)}" x ${fmt(idS)}" | CS ${fmt(cs)}" | OD ${fmt(odL)}" x ${fmt(odS)}"`);
    drawPreview(idL, idS, odL, odS);

    // enable only if filename exists
    setDownloadEnabled(filenameEl.value.trim().length > 0);
  }

  function downloadDXF() {
  const name = filenameEl.value.trim();

  if (!name) {
    setStatus("Enter CAD Name above, then download.", true);
    setDownloadEnabled(false);
    return;
  }

  if (!lastValid) {
    setStatus("Click Validate & Preview first, then download.", true);
    return;
  }

  const odPts = ellipsePoints(lastValid.odL, lastValid.odS, 280);
  const idPts = ellipsePoints(lastValid.idL, lastValid.idS, 280);

  let dxf = "";
  dxf += dxfHeader();
  dxf += dxfPolyline(odPts, "Perimeter", true);
  dxf += dxfPolyline(idPts, "Holes", true);
  dxf += dxfFooter();

  downloadTextFile(`${name}.dxf`, dxf);
  setStatus("DXF downloaded.");
 }

  // ------- Wire up -------
  function init() {
    // initial canvas
    drawPreview(NaN, NaN, NaN, NaN);
    setDownloadEnabled(false);

    validateBtn.addEventListener("click", validateAndPreview);
    downloadBtn.addEventListener("click", downloadDXF);

    filenameEl.addEventListener("input", () => {
      setDownloadEnabled(!!lastValid && filenameEl.value.trim().length > 0);
    });

    // any input change invalidates until re-validated
    [idLongEl, idShortEl, csEl].forEach(inp => {
      inp.addEventListener("input", () => {
        lastValid = null;
        setStatus("Ready.");
        setDownloadEnabled(false);
      });
    });

    window.addEventListener("resize", () => {
      if (lastValid) drawPreview(lastValid.idL, lastValid.idS, lastValid.odL, lastValid.odS);
      else drawPreview(NaN, NaN, NaN, NaN);
    });
  }

  init();
})();
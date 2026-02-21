/* flange.js — Flange gasket generator (DXF R12)
   - OD rectangle (optionally rounded corners)
   - 4 bolt holes using Center-to-Center X/Y
   - Center cutout: Circle (dia) OR Square (X/Y, optional corner radius)
   - Errors only when touching/overlapping (no warnings)
   - DXF uses POLYLINE/VERTEX (Illustrator-friendly)

   Layers:
     - Perimeter: OD
     - Holes: bolt holes + center cutout
*/

(() => {
  const $ = (id) => document.getElementById(id);

  // Inputs
  const odXEl = $("odX");
  const odYEl = $("odY");
  const cornerREl = $("cornerR");

  const bhCCXEl = $("bhCCX");
  const bhCCYEl = $("bhCCY");
  const bhDiaEl = $("bhDia");

  const cutoutTypeEl = $("cutoutType");
  const cutoutDiaEl = $("cutoutDia");
  const cutoutXEl = $("cutoutX");
  const cutoutYEl = $("cutoutY");
  const cutoutREl = $("cutoutR");

  // Optional UI rows
  const circleRow = $("circleRow");
  const circleBlank = $("circleBlank");
  const squareRowX = $("squareRowX");
  const squareRowY = $("squareRowY");
  const squareRadRow = $("squareRadRow");
  const squareRadNote = $("squareRadNote");

  // Controls
  const validateBtn = $("validateBtn");
  const statusEl = $("status");
  const canvas = $("preview");

  const filenameEl = $("filename");
  const downloadBtn = $("downloadBtn");

  let lastValid = null;

  // ---------- Parsing helpers ----------
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

  function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.style.color = isError ? "#b91c1c" : "";
  }

  // Button text behavior (matches your ellipse/firetube)
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

  // ---------- Geometry helpers (rounded rectangle SDF) ----------
  // Signed distance from point (px,py) to boundary of rounded rectangle centered at 0,0
  // half-sizes hw,hh and corner radius rr.
  // Negative = inside (magnitude relates to distance to boundary), Positive = outside.
 // Correct SDF for a rounded rectangle centered at 0,0
// Negative = inside, Positive = outside
function sdfRoundedRect(px, py, hw, hh, rr) {
  const ax = Math.abs(px);
  const ay = Math.abs(py);

  const innerX = hw - rr;
  const innerY = hh - rr;

  const qx = ax - innerX;
  const qy = ay - innerY;

  const mx = Math.max(qx, 0);
  const my = Math.max(qy, 0);

  // Standard SDF: length(max(q,0)) + min(max(qx,qy),0) - rr
  return Math.hypot(mx, my) + Math.min(Math.max(qx, qy), 0) - rr;
}

  // Gap from a circle (center x,y radius r) to OD rounded-rect boundary.
  // >0 = clearance, 0 = touching, <0 = outside/overlap
  function gapCircleToRoundedOD(x, y, r, odX, odY, odR) {
    const hw = odX / 2;
    const hh = odY / 2;
    const rr = clampRadius(odR, odX, odY);
    const sdf = sdfRoundedRect(x, y, hw, hh, rr);
    // If inside, sdf is negative, distance to boundary = -sdf
    // Clearance from circle edge to boundary:
    return (-sdf) - r;
  }

  // Gap from a circle (bolt hole) to a center CUTOUT rounded rectangle boundary.
  // We require the circle to stay OUTSIDE the cutout (not touch or enter).
  // >0 = clearance, 0 = touching, <0 = overlap (hole intrudes into cutout)
  function gapCircleToCenterCutoutRoundedRect(x, y, r, cutX, cutY, cutR) {
    const hw = cutX / 2;
    const hh = cutY / 2;
    const rr = clampRadius(cutR, cutX, cutY);
    const sdf = sdfRoundedRect(x, y, hw, hh, rr);
    // Outside the cutout => sdf positive; gap from circle edge to cutout boundary:
    return sdf - r;
  }

  function clampRadius(r, w, h) {
    const hw = w / 2;
    const hh = h / 2;
    if (!Number.isFinite(r) || r <= 0) return 0;
    return Math.max(0, Math.min(r, Math.min(hw, hh)));
  }

  // ---------- DXF (R12) ----------
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

  function dxfCircle(x, y, r, layer) {
    return [
      "0","CIRCLE",
      "8", layer,
      "10", String(x),
      "20", String(y),
      "30", "0",
      "40", String(r)
    ].join("\n") + "\n";
  }

  // Classic R12 polyline
  function dxfPolyline(points, layer, closed = true) {
    const out = [];
    out.push("0","POLYLINE","8",layer,"66","1","70", closed ? "1" : "0","10","0","20","0","30","0");
    for (const [x, y] of points) {
      out.push("0","VERTEX","8",layer,"10",String(x),"20",String(y),"30","0");
    }
    out.push("0","SEQEND");
    return out.join("\n") + "\n";
  }

  // Rounded-rect perimeter points, centered at 0,0
  function roundedRectPoints(w, h, r, segmentsPerCorner = 24) {
    const hw = w / 2;
    const hh = h / 2;
    const rr = clampRadius(r, w, h);

    // Square corners
    if (rr === 0) {
      return [
        [-hw, -hh],
        [ hw, -hh],
        [ hw,  hh],
        [-hw,  hh],
      ];
    }

    const pts = [];
    function arc(cx, cy, start, end) {
      for (let i = 0; i <= segmentsPerCorner; i++) {
        const t = start + (i / segmentsPerCorner) * (end - start);
        pts.push([cx + rr * Math.cos(t), cy + rr * Math.sin(t)]);
      }
    }

    // top-right -> bottom-right -> bottom-left -> top-left
    arc(hw - rr, -hh + rr, -Math.PI / 2, 0);
    arc(hw - rr,  hh - rr, 0, Math.PI / 2);
    arc(-hw + rr,  hh - rr, Math.PI / 2, Math.PI);
    arc(-hw + rr, -hh + rr, Math.PI, (3 * Math.PI) / 2);

    return pts;
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

  // ---------- Canvas preview ----------
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

  function drawRoundedRect(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.beginPath();
    if (rr === 0) {
      ctx.rect(x, y, w, h);
    } else {
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.closePath();
    }
  }

  function drawPreview(v) {
    const { ctx, w, h } = prepCanvas();
    clear(ctx, w, h);
    crosshair(ctx, w, h);
    if (!v) return;

    const pad = 22;
    const scale = Math.min((w - 2 * pad) / v.odX, (h - 2 * pad) / v.odY);
    const cx = w / 2, cy = h / 2;

    // OD
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2;
    const pxW = v.odX * scale;
    const pxH = v.odY * scale;
    drawRoundedRect(ctx, cx - pxW / 2, cy - pxH / 2, pxW, pxH, (v.cornerR || 0) * scale);
    ctx.stroke();

    // Center cutout (ID)
    ctx.lineWidth = 1.8;
    if (v.cutoutType === "circle") {
      ctx.beginPath();
      ctx.arc(cx, cy, (v.cutoutDia / 2) * scale, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      const sx = v.cutoutX * scale;
      const sy = v.cutoutY * scale;
      drawRoundedRect(ctx, cx - sx / 2, cy - sy / 2, sx, sy, (v.cutoutR || 0) * scale);
      ctx.stroke();
    }

    // Bolt holes
    ctx.lineWidth = 1.6;
    const hx = (v.bhCCX / 2) * scale;
    const hy = (v.bhCCY / 2) * scale;
    const r = (v.bhDia / 2) * scale;

    const pts = [
      [cx - hx, cy - hy],
      [cx + hx, cy - hy],
      [cx - hx, cy + hy],
      [cx + hx, cy + hy],
    ];

    for (const [x, y] of pts) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ---------- Validation ----------
  function validateAndPreview() {
    const odX = parseInches(odXEl.value);
    const odY = parseInches(odYEl.value);
    const cornerR = cornerREl.value.trim() ? parseInches(cornerREl.value) : 0;

    const bhCCX = parseInches(bhCCXEl.value);
    const bhCCY = parseInches(bhCCYEl.value);
    const bhDia = parseInches(bhDiaEl.value);

    const cutoutType = cutoutTypeEl.value;

    const cutoutDia = parseInches(cutoutDiaEl.value);
    const cutoutX = parseInches(cutoutXEl.value);
    const cutoutY = parseInches(cutoutYEl.value);
    const cutoutR = cutoutREl && cutoutREl.value.trim() ? parseInches(cutoutREl.value) : 0;

    const errors = [];

    // Basic numeric validation
    if (!Number.isFinite(odX) || odX <= 0) errors.push("OD X must be a positive number.");
    if (!Number.isFinite(odY) || odY <= 0) errors.push("OD Y must be a positive number.");

    if (cornerREl.value.trim() && (!Number.isFinite(cornerR) || cornerR < 0)) errors.push("Corner Radius must be blank or a non-negative number.");
    if (Number.isFinite(odX) && Number.isFinite(odY) && Number.isFinite(cornerR) && clampRadius(cornerR, odX, odY) !== cornerR) {
      errors.push("Corner Radius is too large for the OD.");
    }

    if (!Number.isFinite(bhCCX) || bhCCX <= 0) errors.push("Bolt Hole Center To Center X must be a positive number.");
    if (!Number.isFinite(bhCCY) || bhCCY <= 0) errors.push("Bolt Hole Center To Center Y must be a positive number.");
    if (!Number.isFinite(bhDia) || bhDia <= 0) errors.push("Bolt Hole Diameter must be a positive number.");

    if (cutoutType === "circle") {
      if (!Number.isFinite(cutoutDia) || cutoutDia <= 0) errors.push("Center Cutout Diameter must be a positive number.");
    } else {
      if (!Number.isFinite(cutoutX) || cutoutX <= 0) errors.push("Center Cutout X must be a positive number.");
      if (!Number.isFinite(cutoutY) || cutoutY <= 0) errors.push("Center Cutout Y must be a positive number.");

      if (cutoutREl && cutoutREl.value.trim() && (!Number.isFinite(cutoutR) || cutoutR < 0)) {
        errors.push("Center Cutout Corner Radius must be blank or a non-negative number.");
      }
      if (Number.isFinite(cutoutX) && Number.isFinite(cutoutY) && Number.isFinite(cutoutR) && clampRadius(cutoutR, cutoutX, cutoutY) !== cutoutR) {
        errors.push("Center Cutout Corner Radius is too large for the cutout.");
      }
    }

    if (errors.length) {
      lastValid = null;
      setStatus("ERRORS: " + errors.join(" "), true);
      drawPreview(null);
      setDownloadEnabled(false);
      return;
    }

    // Geometry calculations
    const holeR = bhDia / 2;
    const hx = bhCCX / 2;
    const hy = bhCCY / 2;

    const holeCenters = [
      [-hx, -hy],
      [ hx, -hy],
      [-hx,  hy],
      [ hx,  hy],
    ];

    // 1) Hole-to-OD clearance (touching not allowed) — accounts for OD corner radius
    let minHoleODGap = Infinity;
    for (const [x, y] of holeCenters) {
      const g = gapCircleToRoundedOD(x, y, holeR, odX, odY, cornerR || 0);
      minHoleODGap = Math.min(minHoleODGap, g);
    }
    if (minHoleODGap <= 0) {
      errors.push("Bolt holes are touching or outside the OD.");
    }

    // 2) Hole-to-hole touching (simple)
    if (bhCCX <= bhDia) errors.push("Bolt holes are touching/overlapping each other on X spacing.");
    if (bhCCY <= bhDia) errors.push("Bolt holes are touching/overlapping each other on Y spacing.");

    // 3) Cutout must fit inside OD (touching not allowed) — accounts for OD corner radius
    if (cutoutType === "circle") {
      const cr = cutoutDia / 2;
      const g = gapCircleToRoundedOD(0, 0, cr, odX, odY, cornerR || 0);
      if (g <= 0) errors.push("Center cutout is touching or outside the OD.");
    } else {
      // Sample cutout boundary points and ensure they're inside OD with clearance > 0
      const pts = roundedRectPoints(cutoutX, cutoutY, cutoutR || 0, 24);
      let minCutoutODGap = Infinity;
      for (const [x, y] of pts) {
        const g = gapCircleToRoundedOD(x, y, 0, odX, odY, cornerR || 0);
        minCutoutODGap = Math.min(minCutoutODGap, g);
      }
      if (minCutoutODGap <= 0) errors.push("Center cutout is touching or outside the OD.");
    }

    // 4) Hole-to-cutout clearance (touching not allowed) — this is your ID↔hole check
    if (cutoutType === "circle") {
      const cr = cutoutDia / 2;
      let minHoleIDGap = Infinity;
      for (const [x, y] of holeCenters) {
        const g = Math.hypot(x, y) - (holeR + cr);
        minHoleIDGap = Math.min(minHoleIDGap, g);
      }
      if (minHoleIDGap <= 0) errors.push("Bolt holes are touching/overlapping the center cutout.");
    } else {
      let minHoleIDGap = Infinity;
      for (const [x, y] of holeCenters) {
        const g = gapCircleToCenterCutoutRoundedRect(x, y, holeR, cutoutX, cutoutY, cutoutR || 0);
        minHoleIDGap = Math.min(minHoleIDGap, g);
      }
      if (minHoleIDGap <= 0) errors.push("Bolt holes are touching/overlapping the center cutout.");
    }

    if (errors.length) {
      lastValid = null;
      setStatus("ERRORS: " + errors.join(" "), true);
      drawPreview(null);
      setDownloadEnabled(false);
      return;
    }

    // Passed validation
    lastValid = {
      odX, odY,
      cornerR: cornerR || 0,
      bhCCX, bhCCY, bhDia,
      cutoutType,
      cutoutDia,
      cutoutX, cutoutY,
      cutoutR: cutoutR || 0
    };

    const cutoutText = (cutoutType === "circle")
      ? `Cutout ${fmt(cutoutDia)}"`
      : `Cutout ${fmt(cutoutX)}" x ${fmt(cutoutY)}" (R ${fmt(cutoutR || 0)}")`;

    // No Ø symbol
    const odText = `OD ${fmt(odX)}" x ${fmt(odY)}"${(cornerR || 0) > 0 ? ` (R ${fmt(cornerR)}")` : ""}`;

setStatus(
  `${odText} | Holes ${fmt(bhDia)}" @ C-C ${fmt(bhCCX)}" x ${fmt(bhCCY)}" | ${cutoutText}`,
  false
);

    drawPreview(lastValid);
    setDownloadEnabled(filenameEl.value.trim().length > 0);
  }

  // ---------- DXF build ----------
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

    const v = lastValid;

    let dxf = "";
    dxf += dxfHeader();

    // OD perimeter
    const odPts = roundedRectPoints(v.odX, v.odY, v.cornerR, 24);
    dxf += dxfPolyline(odPts, "Perimeter", true);

    // Bolt holes (4)
    const hx = v.bhCCX / 2;
    const hy = v.bhCCY / 2;
    const r = v.bhDia / 2;

    const holes = [
      [-hx, -hy],
      [ hx, -hy],
      [-hx,  hy],
      [ hx,  hy],
    ];
    for (const [x, y] of holes) {
      dxf += dxfCircle(x, y, r, "Holes");
    }

    // Center cutout
    if (v.cutoutType === "circle") {
      dxf += dxfCircle(0, 0, v.cutoutDia / 2, "Holes");
    } else {
      const pts = roundedRectPoints(v.cutoutX, v.cutoutY, v.cutoutR, 24);
      dxf += dxfPolyline(pts, "Holes", true);
    }

    dxf += dxfFooter();

    downloadTextFile(`${name}.dxf`, dxf);
    setStatus("DXF downloaded.");
  }

  // ---------- UI toggle ----------
  function updateCutoutUI() {
    const t = cutoutTypeEl.value;

    if (t === "circle") {
      if (circleRow) circleRow.style.display = "";
      if (circleBlank) circleBlank.style.display = "";
      if (squareRowX) squareRowX.style.display = "none";
      if (squareRowY) squareRowY.style.display = "none";
      if (squareRadRow) squareRadRow.style.display = "none";
      if (squareRadNote) squareRadNote.style.display = "none";
    } else {
      if (circleRow) circleRow.style.display = "none";
      if (circleBlank) circleBlank.style.display = "none";
      if (squareRowX) squareRowX.style.display = "";
      if (squareRowY) squareRowY.style.display = "";
      if (squareRadRow) squareRadRow.style.display = "";
      if (squareRadNote) squareRadNote.style.display = "";
    }

    lastValid = null;
    setStatus("Ready.");
    setDownloadEnabled(false);
  }

  // ---------- Init ----------
  function init() {
    setDownloadEnabled(false);
    drawPreview(null);

    cutoutTypeEl.addEventListener("change", updateCutoutUI);

    validateBtn.addEventListener("click", validateAndPreview);
    downloadBtn.addEventListener("click", downloadDXF);

    filenameEl.addEventListener("input", () => {
      setDownloadEnabled(!!lastValid && filenameEl.value.trim().length > 0);
    });

    // Any input change invalidates until re-validated
    [
      odXEl, odYEl, cornerREl,
      bhCCXEl, bhCCYEl, bhDiaEl,
      cutoutDiaEl, cutoutXEl, cutoutYEl, cutoutREl
    ].filter(Boolean).forEach(inp => {
      inp.addEventListener("input", () => {
        lastValid = null;
        setStatus("Ready.");
        setDownloadEnabled(false);
      });
    });

    window.addEventListener("resize", () => drawPreview(lastValid));

    updateCutoutUI();
  }

  init();
})();
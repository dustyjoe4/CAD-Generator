/* jumper.js — Jumper gasket generator (DXF R12)
   OD construction: bolt outer arcs + center outer arcs + straight tangent lines
   Arc selection is forced to the OUTSIDE (no interior arcs).
*/

(() => {
  const $ = (id) => document.getElementById(id);

  const idDiaEl = $("idDia");
  const boltDiaEl = $("boltDia");
  const ccEl = $("cc");
  const boltEdgeToODEl = $("boltEdgeToOD");
  const idEdgeToODEl = $("idEdgeToOD");

  const validateBtn = $("validateBtn");
  const statusEl = $("status");
  const canvas = $("preview");

  const filenameEl = $("filename");
  const downloadBtn = $("downloadBtn");

  let lastValid = null;

  // ---------- parsing ----------
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

  // ---------- geometry ----------
  function angleOf(cx, cy, px, py) {
    return Math.atan2(py - cy, px - cx);
  }

  function arcPoints(cx, cy, r, a0, a1, ccw, maxSegLen = 0.06) {
    let start = a0;
    let end = a1;

    if (ccw) {
      while (end <= start) end += Math.PI * 2;
      const sweep = end - start;
      const n = Math.max(10, Math.ceil((sweep * r) / maxSegLen));
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const a = start + sweep * t;
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
      return pts;
    } else {
      while (end >= start) end -= Math.PI * 2;
      const sweep = start - end;
      const n = Math.max(10, Math.ceil((sweep * r) / maxSegLen));
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const a = start - sweep * t;
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
      return pts;
    }
  }

  // Choose the correct arc (outside) by testing midpoint against a condition
  function chosenArc(cx, cy, r, pStart, pEnd, wantFn) {
    const a0 = angleOf(cx, cy, pStart[0], pStart[1]);
    const a1 = angleOf(cx, cy, pEnd[0], pEnd[1]);

    const arcCCW = arcPoints(cx, cy, r, a0, a1, true);
    const arcCW  = arcPoints(cx, cy, r, a0, a1, false);

    const midCCW = arcCCW[Math.floor(arcCCW.length / 2)];
    const midCW  = arcCW[Math.floor(arcCW.length / 2)];

    const okCCW = wantFn(midCCW[0], midCCW[1]);
    const okCW  = wantFn(midCW[0], midCW[1]);

    if (okCCW && !okCW) return arcCCW;
    if (okCW && !okCCW) return arcCW;

    // If both satisfy (rare), take the shorter
    return arcCCW.length <= arcCW.length ? arcCCW : arcCW;
  }

  // External tangents between circles. Returns {top,bottom} with points on each circle.
  function externalTangents(c1x,c1y,r1, c2x,c2y,r2) {
    const dx = c2x - c1x;
    const dy = c2y - c1y;
    const d = Math.hypot(dx, dy);
    if (!(d > 0)) return null;

    const k = (r1 - r2) / d;
    if (Math.abs(k) > 1) return null;

    const base = Math.atan2(dy, dx);
    const phi = Math.acos(k);

    const aA = base + phi;
    const aB = base - phi;

    const p1A = [c1x + r1 * Math.cos(aA), c1y + r1 * Math.sin(aA)];
    const p2A = [c2x + r2 * Math.cos(aA), c2y + r2 * Math.sin(aA)];

    const p1B = [c1x + r1 * Math.cos(aB), c1y + r1 * Math.sin(aB)];
    const p2B = [c2x + r2 * Math.cos(aB), c2y + r2 * Math.sin(aB)];

    // label top/bottom by y
    if (p1A[1] >= p1B[1]) {
      return { top: { p1: p1A, p2: p2A }, bottom: { p1: p1B, p2: p2B } };
    } else {
      return { top: { p1: p1B, p2: p2B }, bottom: { p1: p1A, p2: p2A } };
    }
  }

  function extents(points) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of points) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return { minX, maxX, minY, maxY, w: (maxX - minX), h: (maxY - minY) };
  }

  // Build OD polyline with OUTSIDE arcs only
  function buildOD(cc, RboltOuter, RidOuter) {
    const L = { x: -cc/2, y: 0, r: RboltOuter };
    const C = { x: 0,     y: 0, r: RidOuter };
    const R = { x: +cc/2, y: 0, r: RboltOuter };

    const tLC = externalTangents(L.x,L.y,L.r, C.x,C.y,C.r);
    if (!tLC) return { error: "Cannot compute tangents between left bolt OD and center OD." };

    const tCR = externalTangents(C.x,C.y,C.r, R.x,R.y,R.r);
    if (!tCR) return { error: "Cannot compute tangents between center OD and right bolt OD." };

    // Tangency points
    const L_top = tLC.top.p1;
    const C_left_top = tLC.top.p2;

    const C_right_top = tCR.top.p1;
    const R_top = tCR.top.p2;

    const R_bot = tCR.bottom.p2;
    const C_right_bot = tCR.bottom.p1;

    const C_left_bot = tLC.bottom.p2;
    const L_bot = tLC.bottom.p1;

    // Choose arcs by “outside” tests:
    // Center top arc: midpoint must be above center (y > 0)
    const arcC_top = chosenArc(C.x, C.y, C.r, C_left_top, C_right_top, (_x, y) => y > 0);
    // Center bottom arc: midpoint must be below center (y < 0)
    const arcC_bot = chosenArc(C.x, C.y, C.r, C_right_bot, C_left_bot, (_x, y) => y < 0);

    // Left bolt outside arc: midpoint must be left of its center (x < L.x)
    const arcL_out = chosenArc(L.x, L.y, L.r, L_bot, L_top, (x, _y) => x < L.x);
    // Right bolt outside arc: midpoint must be right of its center (x > R.x)
    const arcR_out = chosenArc(R.x, R.y, R.r, R_top, R_bot, (x, _y) => x > R.x);

    // Assemble perimeter (clockwise-ish order)
    const pts = [];
    pts.push(L_top);
    pts.push(C_left_top);

    pts.push(...arcC_top.slice(1));   // to C_right_top
    pts.push(R_top);

    pts.push(...arcR_out.slice(1));   // to R_bot
    pts.push(C_right_bot);

    pts.push(...arcC_bot.slice(1));   // to C_left_bot
    pts.push(L_bot);

    pts.push(...arcL_out.slice(1));   // back to L_top

    return { pts };
  }

  // ---------- preview ----------
  function prepCanvas() {
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const cssW = rect.width || 860;
    const cssH = rect.height || 420;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: cssW, h: cssH };
  }

  function drawCrosshair(ctx, w, h) {
    const cx = w / 2, cy = h / 2;
    ctx.strokeStyle = "#e9e9e9";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, cy); ctx.lineTo(w, cy);
    ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
    ctx.stroke();
  }

  function drawPreview(v) {
    const { ctx, w, h } = prepCanvas();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    drawCrosshair(ctx, w, h);

    if (!v) return;

    const pad = 34; // increased to stop clipping
    const cxp = w / 2, cyp = h / 2;

    const e = extents(v.odPts);
    const scale = Math.min((w - 2 * pad) / e.w, (h - 2 * pad) / e.h);

    // OD polyline
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2;
    ctx.beginPath();
    v.odPts.forEach(([x,y], i) => {
      const px = cxp + x * scale;
      const py = cyp + y * scale;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.stroke();

    // ID + bolt holes only
    ctx.lineWidth = 1.7;

    // ID
    ctx.beginPath();
    ctx.arc(cxp, cyp, v.idR * scale, 0, Math.PI * 2);
    ctx.stroke();

    // bolts
    const hx = (v.cc / 2) * scale;
    const r = v.boltR * scale;
    [[cxp - hx, cyp], [cxp + hx, cyp]].forEach(([x,y]) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
    });
  }

  // ---------- validate ----------
  function validateAndPreview() {
    const idDia = parseInches(idDiaEl.value);
    const boltDia = parseInches(boltDiaEl.value);
    const cc = parseInches(ccEl.value);
    const boltEdgeToOD = parseInches(boltEdgeToODEl.value);
    const idEdgeToOD = parseInches(idEdgeToODEl.value);

    const errors = [];
    if (!Number.isFinite(idDia) || idDia <= 0) errors.push("Center ID Diameter must be a positive number.");
    if (!Number.isFinite(boltDia) || boltDia <= 0) errors.push("Bolt Hole Diameter must be a positive number.");
    if (!Number.isFinite(cc) || cc <= 0) errors.push("Bolt Hole Center To Center must be a positive number.");
    if (!Number.isFinite(boltEdgeToOD) || boltEdgeToOD < 0) errors.push("Bolt Hole Edge To OD must be zero or a positive number.");
    if (!Number.isFinite(idEdgeToOD) || idEdgeToOD < 0) errors.push("ID Edge To OD must be zero or a positive number.");

    if (errors.length) {
      lastValid = null;
      setStatus("ERRORS: " + errors.join(" "), true);
      drawPreview(null);
      setDownloadEnabled(false);
      return;
    }

    const idR = idDia / 2;
    const boltR = boltDia / 2;

    // hard collisions (holes touching/overlapping)
    if (cc <= boltDia) errors.push("Bolt holes are touching/overlapping each other.");
    if ((cc / 2) <= (boltR + idR)) errors.push("Bolt holes are touching/overlapping the center ID hole.");

    if (errors.length) {
      lastValid = null;
      setStatus("ERRORS: " + errors.join(" "), true);
      drawPreview(null);
      setDownloadEnabled(false);
      return;
    }

    const RboltOuter = boltR + boltEdgeToOD;
    const RidOuter = idR + idEdgeToOD;

    // Tangents must exist between outer circles (external tangents require d > |r1-r2|)
    const d = cc / 2;
    if (d <= Math.abs(RboltOuter - RidOuter)) {
      lastValid = null;
      setStatus(
        "ERRORS: OD offsets create a contained-circle condition — cannot form straight tangent lines. Adjust OD offsets or spacing.",
        true
      );
      drawPreview(null);
      setDownloadEnabled(false);
      return;
    }

    const built = buildOD(cc, RboltOuter, RidOuter);
    if (built.error) {
      lastValid = null;
      setStatus("ERRORS: " + built.error, true);
      drawPreview(null);
      setDownloadEnabled(false);
      return;
    }

    const odPts = built.pts;
    const ex = extents(odPts);

    lastValid = {
      idDia, boltDia, cc, boltEdgeToOD, idEdgeToOD,
      idR, boltR,
      RboltOuter, RidOuter,
      odPts
    };

    setStatus(
      `ID: ${fmt(idDia)}" | Bolts: ${fmt(boltDia)}" @ C-C ${fmt(cc)}" | Bolt Edge → OD: ${fmt(boltEdgeToOD)}" | ID Edge → OD: ${fmt(idEdgeToOD)}" | OD Approx: ${fmt(ex.w)}" x ${fmt(ex.h)}"`,
      false
    );

    drawPreview(lastValid);
    setDownloadEnabled(filenameEl.value.trim().length > 0);
  }

  // ---------- download ----------
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

    // OD outline
    dxf += dxfPolyline(v.odPts, "Perimeter", true);

    // Holes only: center ID + 2 bolts
    dxf += dxfCircle(0, 0, v.idR, "Holes");
    dxf += dxfCircle(-v.cc / 2, 0, v.boltR, "Holes");
    dxf += dxfCircle( v.cc / 2, 0, v.boltR, "Holes");

    dxf += dxfFooter();

    downloadTextFile(`${name}.dxf`, dxf);
    setStatus("DXF downloaded.");
  }

  // ---------- init ----------
  function init() {
    setDownloadEnabled(false);
    drawPreview(null);

    validateBtn.addEventListener("click", validateAndPreview);
    downloadBtn.addEventListener("click", downloadDXF);

    filenameEl.addEventListener("input", () => {
      setDownloadEnabled(!!lastValid && filenameEl.value.trim().length > 0);
    });

    // Any input change invalidates until re-validated
    [idDiaEl, boltDiaEl, ccEl, boltEdgeToODEl, idEdgeToODEl].forEach(inp => {
      inp.addEventListener("input", () => {
        lastValid = null;
        setStatus("Ready.");
        setDownloadEnabled(false);
      });
    });

    window.addEventListener("resize", () => drawPreview(lastValid));
  }

  init();
})();
/* Firetube CAD Generator (local) */

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const canvas = $("preview");
const ctx = canvas.getContext("2d");

function setStatus(msg) { statusEl.textContent = msg; }

/* -----------------------------
   Download button enable/disable + text swap
-------------------------------- */
function updateDownloadEnabled() {
  const name = String($("filename").value || "").trim();
  const btn = $("downloadBtn");

  const enabled = !!name;
  btn.disabled = !enabled;

  // Swap button text based on state
  btn.textContent = enabled ? "Download DXF File" : "Enter CAD Name to Download";
}

// Cross Section toggles ID fields
const crossSectionInput = document.getElementById("crossSection");
const idLongInput = document.getElementById("idLong");
const idShortInput = document.getElementById("idShort");

function updateCrossSectionLock(){
  const hasValue = crossSectionInput.value.trim() !== "";

  if(hasValue){
    idLongInput.classList.add("isDisabled");
    idShortInput.classList.add("isDisabled");

    idLongInput.disabled = true;
    idShortInput.disabled = true;
  }else{
    idLongInput.classList.remove("isDisabled");
    idShortInput.classList.remove("isDisabled");

    idLongInput.disabled = false;
    idShortInput.disabled = false;
  }
}

// Run on typing
crossSectionInput.addEventListener("input", updateCrossSectionLock);

// Run once on load
updateCrossSectionLock();

/* -----------------------------
   Parsing (supports fractions)
-------------------------------- */
function parseInches(str) {
  const raw = String(str || "").trim();
  if (!raw) throw new Error("Empty value");

  // "1 1/2"
  const mixed = raw.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const whole = parseInt(mixed[1], 10);
    const num = parseInt(mixed[2], 10);
    const den = parseInt(mixed[3], 10);
    if (den === 0) throw new Error(`Invalid fraction "${raw}"`);
    return whole + (num / den);
  }

  // "3/4"
  const frac = raw.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) {
    const num = parseInt(frac[1], 10);
    const den = parseInt(frac[2], 10);
    if (den === 0) throw new Error(`Invalid fraction "${raw}"`);
    return num / den;
  }

  const val = Number(raw);
  if (!Number.isFinite(val)) throw new Error(`Invalid number "${raw}"`);
  return val;
}

function fmt(n) { return (Math.round(n * 1000000) / 1000000).toString(); }
function fmtIn(n) {
  const s = (Math.round(n * 1000000) / 1000000).toString();
  if (s.startsWith(".")) return "0" + s;
  if (s.startsWith("-.")) return s.replace("-.", "-0.");
  return s;
}

/* -----------------------------
   Required fields (NOT filename)
-------------------------------- */
const REQUIRED_FIELDS = [
  { id: "odLong",    name: "Long Side OD" },
  { id: "odShort",   name: "Short Side OD" },
  { id: "bcLong",    name: "Long Side BC" },
  { id: "bcShort",   name: "Short Side BC" },
  { id: "holeCount", name: "Hole Count" },
  { id: "holeDia",   name: "Hole Diameter" },
];

function isBlank(id) {
  return !String($(id).value || "").trim();
}

function requireFilled(id, label) {
  if (isBlank(id)) throw new Error(`${label} is required.`);
}

/* -----------------------------
   DXF primitives
-------------------------------- */
function addLayerDef(dxf, name) {
  dxf.push("0","LAYER","2",name,"70","0","62","7","6","CONTINUOUS");
}
function addLine(dxf, layer, x1, y1, x2, y2) {
  dxf.push("0","LINE","8",layer,"10",fmt(x1),"20",fmt(y1),"30","0","11",fmt(x2),"21",fmt(y2),"31","0");
}
function addArc(dxf, layer, cx, cy, r, a1, a2) {
  dxf.push("0","ARC","8",layer,"10",fmt(cx),"20",fmt(cy),"30","0","40",fmt(r),"50",fmt(a1),"51",fmt(a2));
}
function addCircle(dxf, layer, cx, cy, r) {
  dxf.push("0","CIRCLE","8",layer,"10",fmt(cx),"20",fmt(cy),"30","0","40",fmt(r));
}

/* -----------------------------
   Obround outline
-------------------------------- */
function addObroundOutline(dxf, layer, longDim, shortDim, offsetX=0, offsetY=0) {
  const L = longDim;
  const W = shortDim;
  if (L < W) throw new Error(`Long (${L}) must be ≥ Short (${W}).`);

  const r = W / 2;
  const halfStraight = (L - W) / 2;
  const cx = halfStraight;

  addLine(dxf, layer, offsetX - cx, offsetY + r, offsetX + cx, offsetY + r);
  addLine(dxf, layer, offsetX + cx, offsetY - r, offsetX - cx, offsetY - r);
  addArc(dxf, layer, offsetX + cx, offsetY, r, 270, 90);
  addArc(dxf, layer, offsetX - cx, offsetY, r, 90, 270);
}

/* -----------------------------
   BC perimeter + hole placement
-------------------------------- */
function obroundPerimeter(L, W) {
  const r = W / 2;
  const straight = L - W;
  return (2 * straight) + (2 * Math.PI * r);
}

function perimeterPointObround(L, W, dist) {
  const r = W / 2;
  const straight = L - W;
  const cx = straight / 2;

  const quarterArcLen = (Math.PI * r) / 2;
  const leftSemiLen   = Math.PI * r;

  const total = (2 * straight) + (2 * Math.PI * r);
  let d = ((dist % total) + total) % total;

  if (d <= quarterArcLen) {
    const t = d / quarterArcLen;
    const ang = (0 + 90 * t) * Math.PI / 180;
    return [cx + r * Math.cos(ang), r * Math.sin(ang)];
  }
  d -= quarterArcLen;

  if (d <= straight) {
    const t = d / straight;
    return [cx + (-2*cx * t), r];
  }
  d -= straight;

  if (d <= leftSemiLen) {
    const t = d / leftSemiLen;
    const ang = (90 + 180 * t) * Math.PI / 180;
    return [-cx + r * Math.cos(ang), r * Math.sin(ang)];
  }
  d -= leftSemiLen;

  if (d <= straight) {
    const t = d / straight;
    return [-cx + (2*cx * t), -r];
  }
  d -= straight;

  const t = d / quarterArcLen;
  const ang = (270 + 90 * t) * Math.PI / 180;
  return [cx + r * Math.cos(ang), r * Math.sin(ang)];
}

/* -----------------------------
   Cross Section -> auto-fill ID + lock
-------------------------------- */
function crossSectionRaw() {
  return String($("crossSection").value || "").trim();
}
function crossSectionValueOrNull() {
  const raw = crossSectionRaw();
  if (!raw) return null;
  return parseInches(raw);
}

function setIdLocked(locked) {
  $("idLong").readOnly = locked;
  $("idShort").readOnly = locked;
}

function applyCrossSectionToIDIfPresent() {
  const cs = crossSectionValueOrNull();
  if (cs == null) {
    setIdLocked(false);
    return false;
  }

  // OD must be typed if using cross section
  requireFilled("odLong", "Long Side OD");
  requireFilled("odShort", "Short Side OD");

  const odLong = parseInches($("odLong").value);
  const odShort = parseInches($("odShort").value);

  const newIdLong = odLong - 2 * cs;
  const newIdShort = odShort - 2 * cs;

  $("idLong").value = fmtIn(Math.round(newIdLong * 1000) / 1000);
  $("idShort").value = fmtIn(Math.round(newIdShort * 1000) / 1000);

  setIdLocked(true);
  return true;
}

/* -----------------------------
   Inputs + derived
-------------------------------- */
function sanitizeFilenameBase(base) {
  let s = String(base || "").trim();
  s = s.replace(/\.dxf$/i, "");
  if (!s) s = "firetube_gasket";
  return s;
}

function computeHoleCenters(inputs) {
  const P = obroundPerimeter(inputs.bcLong, inputs.bcShort);
  const N = inputs.holeCount;
  const c2c = P / N;
  const shift = (inputs.centerMode === "off") ? (c2c / 2) : 0;

  const centers = [];
  for (let i = 0; i < N; i++) {
    const d = i * c2c + shift;
    centers.push(perimeterPointObround(inputs.bcLong, inputs.bcShort, d));
  }
  return { centers, c2c };
}

function requireAllMandatory() {
  // base required fields
  for (const f of REQUIRED_FIELDS) requireFilled(f.id, f.name);

  // ID required only if cross section is blank
  if (!crossSectionRaw()) {
    requireFilled("idLong", "Long Side ID");
    requireFilled("idShort", "Short Side ID");
  }
}

function computeInputs() {
  // enforce mandatory typing BEFORE parsing
  requireAllMandatory();

  // apply cross section if present (locks ID)
  applyCrossSectionToIDIfPresent();

  const odLong = parseInches($("odLong").value);
  const odShort = parseInches($("odShort").value);

  const idLong = parseInches($("idLong").value);
  const idShort = parseInches($("idShort").value);

  const bcLong = parseInches($("bcLong").value);
  const bcShort = parseInches($("bcShort").value);

  const holeCount = parseInt($("holeCount").value, 10);
  const holeDia = parseInches($("holeDia").value);

  const centerMode = $("centerMode").value;

  if (odLong < odShort) throw new Error("Long Side OD must be the same as or larger than Short Side OD.");
  if (idLong < idShort) throw new Error("Long Side ID must be the same as or larger than Short Side ID.");
  if (bcLong < bcShort) throw new Error("Long Side BC must be the same as or larger than Short Side BC.");

  if (idLong >= odLong || idShort >= odShort) throw new Error("ID must be smaller than OD.");
  if (bcLong > odLong || bcShort > odShort) throw new Error("BC must fit inside OD.");

  if (!(holeCount > 0)) throw new Error("Hole count must be greater than zero.");
  if (!(holeDia > 0)) throw new Error("Hole diameter must be greater than zero.");

  const P = obroundPerimeter(bcLong, bcShort);
  const c2c = P / holeCount;
  if (c2c <= holeDia) {
    throw new Error("Bolt holes overlap: Bolt Hole Center To Center is not large enough for the hole diameter.");
  }

  return { odLong, odShort, idLong, idShort, bcLong, bcShort, holeCount, holeDia, centerMode };
}

/* -----------------------------
   Clearance math (side-based)
-------------------------------- */
function clearanceBreakdownBySides(inputs) {
  const holeR = inputs.holeDia / 2;

  // long side uses SHORT dims; short side uses LONG dims
  const longToOD  = ((inputs.odShort - inputs.bcShort) / 2) - holeR;
  const shortToOD = ((inputs.odLong  - inputs.bcLong ) / 2) - holeR;

  const longToID  = ((inputs.bcShort - inputs.idShort) / 2) - holeR;
  const shortToID = ((inputs.bcLong  - inputs.idLong ) / 2) - holeR;

  return { longToOD, longToID, shortToOD, shortToID };
}

function evaluateClearances(bd) {
  const warnings = [];
  const errors = [];

  function rule(label, value) {
    if (value < 0.5) {
      errors.push(`${label}: Current clearance is ${value.toFixed(3)} inches.`);
    } else if (value < 1.0) {
      warnings.push(`${label}: Current clearance is ${value.toFixed(3)} inches.`);
    }
  }

  rule("Long Side - Edge Of Hole to OD", bd.longToOD);
  rule("Long Side - Edge Of Hole to ID", bd.longToID);
  rule("Short Side - Edge Of Hole to OD", bd.shortToOD);
  rule("Short Side - Edge Of Hole to ID", bd.shortToID);

  return { warnings, errors };
}

/* -----------------------------
   DXF Build
-------------------------------- */
function buildDXF(inputs, holeCenters) {
  const dxf = [];
  dxf.push("0","SECTION","2","HEADER");
  dxf.push("9","$INSUNITS","70","1");
  dxf.push("0","ENDSEC");

  dxf.push("0","SECTION","2","TABLES");
  dxf.push("0","TABLE","2","LAYER","70","2");
  dxf.push("0","TABLE","2","LAYER","70","2");
  dxf.pop(); // (noop safety; keeps structure simple)

  // Write layer table properly
  dxf.push("0","TABLE","2","LAYER","70","2");
  addLayerDef(dxf, "Perimeter");
  addLayerDef(dxf, "Holes");
  dxf.push("0","ENDTAB");
  dxf.push("0","ENDSEC");

  dxf.push("0","SECTION","2","ENTITIES");
  addObroundOutline(dxf, "Perimeter", inputs.odLong, inputs.odShort, 0, 0);
  addObroundOutline(dxf, "Holes", inputs.idLong, inputs.idShort, 0, 0);

  const holeR = inputs.holeDia / 2;
  for (const [x, y] of holeCenters) addCircle(dxf, "Holes", x, y, holeR);

  dxf.push("0","ENDSEC","0","EOF");
  return dxf.join("\n");
}

/* -----------------------------
   Preview drawing
-------------------------------- */
function drawPreview(inputs, holeCenters) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const pad = 10;
  const scaleX = (canvas.width - 2 * pad) / (inputs.odLong + 2);
  const scaleY = (canvas.height - 2 * pad) / (inputs.odShort + 2);
  const scale = Math.min(scaleX, scaleY);

  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  function toScreen(x, y) { return [cx + x * scale, cy - y * scale]; }

  // faint center crosshair
  ctx.strokeStyle = "#e6e6e6";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, cy); ctx.lineTo(canvas.width, cy);
  ctx.moveTo(cx, 0); ctx.lineTo(cx, canvas.height);
  ctx.stroke();

  function strokeObround(L, W) {
    const r = W / 2;
    const hs = (L - W) / 2;
    const rightCx = hs;
    const leftCx = -hs;

    ctx.beginPath();
    const [sx, sy] = toScreen(rightCx, -r);
    ctx.moveTo(sx, sy);

    ctx.arc(...toScreen(rightCx, 0), r * scale, (Math.PI / 2), (Math.PI * 3 / 2), true);

    const [tx, ty] = toScreen(leftCx, r);
    ctx.lineTo(tx, ty);

    ctx.arc(...toScreen(leftCx, 0), r * scale, (Math.PI * 3 / 2), (Math.PI / 2), true);

    const [bx, by] = toScreen(rightCx, -r);
    ctx.lineTo(bx, by);

    ctx.stroke();
  }

  // OD
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  strokeObround(inputs.odLong, inputs.odShort);

  // ID
  ctx.lineWidth = 1.5;
  strokeObround(inputs.idLong, inputs.idShort);

  // holes
  const holeR = inputs.holeDia / 2;
  ctx.lineWidth = 1;
  for (const [x, y] of holeCenters) {
    const [px, py] = toScreen(x, y);
    ctx.beginPath();
    ctx.arc(px, py, holeR * scale, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/* -----------------------------
   Validate / Download
-------------------------------- */
function runValidation() {
  const inputs = computeInputs();
  const { centers, c2c } = computeHoleCenters(inputs);

  const bd = clearanceBreakdownBySides(inputs);
  const evals = evaluateClearances(bd);

  drawPreview(inputs, centers);

  const lines = [];
  if (evals.errors.length) {
    lines.push("ERRORS:");
    for (const e of evals.errors) lines.push("• " + e);
    lines.push("");
  }
  if (evals.warnings.length) {
    lines.push("WARNINGS:");
    for (const w of evals.warnings) lines.push("• " + w);
    lines.push("");
  }

  lines.push(
    `OD: ${fmtIn(inputs.odLong)}" x ${fmtIn(inputs.odShort)}"`,
    `ID: ${fmtIn(inputs.idLong)}" x ${fmtIn(inputs.idShort)}"`,
    `BC: ${fmtIn(inputs.bcLong)}" x ${fmtIn(inputs.bcShort)}"`,
    `Holes: ${inputs.holeCount} @ ${fmtIn(inputs.holeDia)}"`,
    ``,
    `Bolt Hole Center To Center: ${c2c.toFixed(4)}"`,
    ``,
    `Pattern: ${inputs.centerMode === "on" ? "On Center" : "Off Center"}`,
    ``,
    `Long Side - Edge Of Hole to OD: ${bd.longToOD.toFixed(3)}"`,
    `Long Side - Edge Of Hole to ID: ${bd.longToID.toFixed(3)}"`,
    ``,
    `Short Side - Edge Of Hole to OD: ${bd.shortToOD.toFixed(3)}"`,
    `Short Side - Edge Of Hole to ID: ${bd.shortToID.toFixed(3)}"`
  );

  setStatus(lines.join("\n"));
  return { inputs, centers, evals };
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
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* -----------------------------
   UI wiring
-------------------------------- */
function refreshIdLocking() {
  try { applyCrossSectionToIDIfPresent(); }
  catch { /* ignore while typing */ }
}

$("filename").addEventListener("input", updateDownloadEnabled);

$("crossSection").addEventListener("input", refreshIdLocking);
$("odLong").addEventListener("input", refreshIdLocking);
$("odShort").addEventListener("input", refreshIdLocking);

$("validateBtn").addEventListener("click", () => {
  try { runValidation(); }
  catch (e) { setStatus("ERROR: " + e.message); }
});

$("downloadBtn").addEventListener("click", () => {
  try {
    const cadName = String($("filename").value || "").trim();
    if (!cadName) {
      setStatus("ERROR: Please enter a CAD Name before downloading.");
      updateDownloadEnabled();
      return;
    }

    const result = runValidation();
    if (result.evals.errors.length) return;

    const base = sanitizeFilenameBase(cadName);
    const outName = base + ".dxf";

    const dxf = buildDXF(result.inputs, result.centers);
    downloadTextFile(outName, dxf);

    setStatus(statusEl.textContent + `\n\nSaved: ${outName}`);
  } catch (e) {
    setStatus("ERROR: " + e.message);
  }
});

/* -----------------------------
   Init
-------------------------------- */
(function init() {
  setStatus("Ready.");
  ctx.clearRect(0,0,canvas.width,canvas.height);
  refreshIdLocking();
  updateDownloadEnabled(); // sets initial disabled state + button text
})();
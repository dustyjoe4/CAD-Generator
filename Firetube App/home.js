/* home.js
   Home page preview drawings (no crosshairs).
   Fix: Path2D arcs must be separated with moveTo() or they connect with lines.
*/

(() => {
  const TAU = Math.PI * 2;

  function clear(ctx, w, h) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
  }

  // stroke in SCREEN pixels (px), compensated for current model scale
  function strokePath(ctx, path, px, scale) {
    ctx.strokeStyle = "#111";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = px / scale; // keep consistent thickness
    ctx.stroke(path);
  }

  function addCircle(path, x, y, r) {
    // IMPORTANT: prevents a line from previous subpath to this circle
    path.moveTo(x + r, y);
    path.arc(x, y, r, 0, TAU);
  }

  function circlePath(cx, cy, r) {
    const p = new Path2D();
    addCircle(p, cx, cy, r);
    return p;
  }

  function ellipsePath(long, short) {
    const a = long / 2;
    const b = short / 2;
    const p = new Path2D();
    // ellipse() starts a new subpath; fine
    p.ellipse(0, 0, a, b, 0, 0, TAU);
    return p;
  }

  // Obround centered at (0,0), long axis X, short axis Y
  function obroundPath(long, short) {
    const L = Math.max(long, short);
    const S = Math.min(long, short);
    const r = S / 2;
    const halfL = L / 2;

    const p = new Path2D();
    p.moveTo(-halfL + r, r);
    p.lineTo(halfL - r, r);
    p.arc(halfL - r, 0, r, Math.PI / 2, -Math.PI / 2, true);
    p.lineTo(-halfL + r, -r);
    p.arc(-halfL + r, 0, r, -Math.PI / 2, Math.PI / 2, true);
    p.closePath();
    return p;
  }

  // Points evenly spaced around an obround perimeter (arc-length spaced)
  function obroundPerimeterPoints(long, short, n) {
    const L = Math.max(long, short);
    const S = Math.min(long, short);
    const r = S / 2;
    const halfL = L / 2;

    const topLen = (L - 2 * r);
    const arcLen = Math.PI * r;     // semicircle
    const perim = 2 * topLen + 2 * arcLen;

    const pts = [];
    for (let i = 0; i < n; i++) {
      const step = perim / n;
        const s = (i + .4) * step;   // <-- half-step offset

      let x, y;

      if (s < topLen) {
        x = (-halfL + r) + s;
        y = +r;
      } else if (s < topLen + arcLen) {
        const t = (s - topLen) / arcLen;          // 0..1
        const ang = Math.PI / 2 - t * Math.PI;    // +90 -> -90
        x = (halfL - r) + r * Math.cos(ang);
        y = r * Math.sin(ang);
      } else if (s < topLen + arcLen + topLen) {
        const u = s - (topLen + arcLen);
        x = (halfL - r) - u;
        y = -r;
      } else {
        const v = s - (topLen + arcLen + topLen);
        const t = v / arcLen;                     // 0..1
        const ang = Math.PI / 2 + t * Math.PI;    // +90 -> +270
        x = (-halfL + r) + r * Math.cos(ang);
        y = r * Math.sin(ang);
        }

      pts.push({ x, y });
    }
    return pts;
  }

  function roundedRectPath(x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    const p = new Path2D();
    p.moveTo(x + rr, y);
    p.lineTo(x + w - rr, y);
    p.arcTo(x + w, y, x + w, y + rr, rr);
    p.lineTo(x + w, y + h - rr);
    p.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    p.lineTo(x + rr, y + h);
    p.arcTo(x, y + h, x, y + h - rr, rr);
    p.lineTo(x, y + rr);
    p.arcTo(x, y, x + rr, y, rr);
    p.closePath();
    return p;
  }

  // Fit bbox into canvas and return scale (model->px)
  function fitToCanvas(ctx, w, h, bbox, pad = 18) {
    const bw = bbox.maxX - bbox.minX;
    const bh = bbox.maxY - bbox.minY;

    const sx = (w - 2 * pad) / bw;
    const sy = (h - 2 * pad) / bh;
    const s = Math.min(sx, sy);

    ctx.setTransform(
      s, 0,
      0, -s,
      w / 2 - s * (bbox.minX + bw / 2),
      h / 2 + s * (bbox.minY + bh / 2)
    );

    return s;
  }

  // ---- Jumper outer path ----
  function outerTangents(A, B) {
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const d = Math.hypot(dx, dy);
    const dr = A.r - B.r;

    const base = Math.atan2(dy, dx);
    const ang = Math.acos(Math.min(1, Math.max(-1, dr / d)));

    const t1 = base + ang;
    const t2 = base - ang;

    const top = {
      p1: { x: A.x + A.r * Math.cos(t1), y: A.y + A.r * Math.sin(t1) },
      p2: { x: B.x + B.r * Math.cos(t1), y: B.y + B.r * Math.sin(t1) }
    };

    const bot = {
      p1: { x: A.x + A.r * Math.cos(t2), y: A.y + A.r * Math.sin(t2) },
      p2: { x: B.x + B.r * Math.cos(t2), y: B.y + B.r * Math.sin(t2) }
    };

    if (top.p2.y < bot.p2.y) return { top: bot, bot: top };
    return { top, bot };
  }

  function arcPath(path, circle, startAng, endAng) {
    let a0 = startAng, a1 = endAng;
    while (a1 <= a0) a1 += TAU;
    path.arc(circle.x, circle.y, circle.r, a0, a1, false);
  }

  function jumperOuterPath(C, L, R) {
    const tCL = outerTangents(C, L);
    const tCR = outerTangents(C, R);

    const a = (P, O) => Math.atan2(P.y - O.y, P.x - O.x);

    const C_topL = tCL.top.p1, L_top = tCL.top.p2;
    const C_botL = tCL.bot.p1, L_bot = tCL.bot.p2;

    const C_topR = tCR.top.p1, R_top = tCR.top.p2;
    const C_botR = tCR.bot.p1, R_bot = tCR.bot.p2;

    const p = new Path2D();

    p.moveTo(L_top.x, L_top.y);
    arcPath(p, L, a(L_top, L), a(L_bot, L));
    p.lineTo(C_botL.x, C_botL.y);
    arcPath(p, C, a(C_botL, C), a(C_botR, C));
    p.lineTo(R_bot.x, R_bot.y);
    arcPath(p, R, a(R_bot, R), a(R_top, R));
    p.lineTo(C_topR.x, C_topR.y);
    arcPath(p, C, a(C_topR, C), a(C_topL, C));
    p.closePath();

    return p;
  }

  // -----------------------------
  // Preview drawings
  // -----------------------------
  function drawFiretubePreview(canvas) {
    const ctx = canvas.getContext("2d");
    clear(ctx, canvas.width, canvas.height);

    // sample “nice” preview
    const odLong = 50, odShort = 24;
    const idLong = 42, idShort = 16;

    const bcLong = 46, bcShort = 20;
    const holeDia = 0.75;
    const holeR = holeDia / 2;
    const holeCount = 30;

    const bbox = {
      minX: -odLong / 2,
      maxX: +odLong / 2,
      minY: -odShort / 2,
      maxY: +odShort / 2
    };

    ctx.save();
    const s = fitToCanvas(ctx, canvas.width, canvas.height, bbox, 22);

    strokePath(ctx, obroundPath(odLong, odShort), 2.4, s);
    strokePath(ctx, obroundPath(idLong, idShort), 2.0, s);

    const pts = obroundPerimeterPoints(bcLong, bcShort, holeCount);
    const holes = new Path2D();
    for (const p of pts) addCircle(holes, p.x, p.y, holeR);
    strokePath(ctx, holes, 1.6, s);

    ctx.restore();
  }

  function drawEllipsePreview(canvas) {
    const ctx = canvas.getContext("2d");
    clear(ctx, canvas.width, canvas.height);

    const idLong = 16, idShort = 12;
    const cs = 1.25;
    const odLong = idLong + 2 * cs;
    const odShort = idShort + 2 * cs;

    const bbox = {
      minX: -odLong / 2,
      maxX: +odLong / 2,
      minY: -odShort / 2,
      maxY: +odShort / 2
    };

    ctx.save();
    const s = fitToCanvas(ctx, canvas.width, canvas.height, bbox, 22);

    strokePath(ctx, ellipsePath(odLong, odShort), 2.2, s);
    strokePath(ctx, ellipsePath(idLong, idShort), 2.0, s);

    ctx.restore();
  }

  function drawFlangePreview(canvas) {
    const ctx = canvas.getContext("2d");
    clear(ctx, canvas.width, canvas.height);

    const odX = 5, odY = 5;
    const odR = 0.5;
    const holeDia = 0.5, holeR = holeDia / 2;
    const c2cX = 3.5, c2cY = 3.5;
    const idDia = 3.0, idR = idDia / 2;

    const bbox = {
      minX: -odX / 2,
      maxX: +odX / 2,
      minY: -odY / 2,
      maxY: +odY / 2
    };

    ctx.save();
    const s = fitToCanvas(ctx, canvas.width, canvas.height, bbox, 22);

    strokePath(ctx, roundedRectPath(-odX / 2, -odY / 2, odX, odY, odR), 2.4, s);
    strokePath(ctx, circlePath(0, 0, idR), 2.0, s);

    const hx = c2cX / 2;
    const hy = c2cY / 2;
    const holes = new Path2D();
    addCircle(holes, +hx, +hy, holeR);
    addCircle(holes, -hx, +hy, holeR);
    addCircle(holes, +hx, -hy, holeR);
    addCircle(holes, -hx, -hy, holeR);
    strokePath(ctx, holes, 1.6, s);

    ctx.restore();
  }

  function drawJumperPreview(canvas) {
    const ctx = canvas.getContext("2d");
    clear(ctx, canvas.width, canvas.height);

    const idDia = 3.0;
    const boltDia = 0.5;
    const c2c = 6.0;
    const boltEdgeToOD = 0.5;
    const idEdgeToOD = 0.5;

    const idR = idDia / 2;
    const boltR = boltDia / 2;
    const centerOD_R = idR + idEdgeToOD;
    const boltOD_R = boltR + boltEdgeToOD;

    const L = { x: -c2c / 2, y: 0, r: boltOD_R };
    const R = { x: +c2c / 2, y: 0, r: boltOD_R };
    const C = { x: 0, y: 0, r: centerOD_R };

    const bbox = {
      minX: Math.min(L.x - L.r, C.x - C.r, R.x - R.r),
      maxX: Math.max(L.x + L.r, C.x + C.r, R.x + R.r),
      minY: Math.min(L.y - L.r, C.y - C.r, R.y - R.r),
      maxY: Math.max(L.y + L.r, C.y + C.r, R.y + R.r)
    };

    ctx.save();
    const s = fitToCanvas(ctx, canvas.width, canvas.height, bbox, 22);

    strokePath(ctx, jumperOuterPath(C, L, R), 2.4, s);
    strokePath(ctx, circlePath(0, 0, idR), 2.0, s);

    const holes = new Path2D();
    addCircle(holes, L.x, L.y, boltR);
    addCircle(holes, R.x, R.y, boltR);
    strokePath(ctx, holes, 1.6, s);

    ctx.restore();
  }

  function init() {
    const ft = document.getElementById("prevFiretube");
    const el = document.getElementById("prevEllipse");
    const fl = document.getElementById("prevFlange");
    const ju = document.getElementById("prevJumper");

    if (ft) drawFiretubePreview(ft);
    if (el) drawEllipsePreview(el);
    if (fl) drawFlangePreview(fl);
    if (ju) drawJumperPreview(ju);
  }

  window.addEventListener("DOMContentLoaded", init);
})();
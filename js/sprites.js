// Pixel-art sprites, painted once at startup from polygons. Every vehicle
// faces right. Sizes use one scale (1px is about 6cm), traced from Tesla's
// October 2026 Roadster reveal photos.
'use strict';

const PALETTE = {
  night: '#07080b',
  roadsterWhite: '#dfe2e6',
  roadsterHighlight: '#f7f8fa',
  roadsterShade: '#b9bdc4',
  roadsterShadeDeep: '#9da2aa',
  skirt: '#2d3036',
  skirtEdge: '#1c1e22',
  wheelWell: '#0c0d10',
  glass: '#232933',
  glassShine: '#52606f',
  amber: '#ffa53d',
  red: '#ff3a3a',
  headlight: '#effbff',
  teslaRed: '#e82127',
  gas: '#e9fbff',
};

/**
 * Builds a sprite whose body is a polygon, shaded with a highlight along the
 * top edge and darker bands near the bottom.
 */
function paintBody(p, spec) {
  const {body, base, highlight, shade, shadeDeep} = spec;
  p.poly(body, highlight);
  p.onlyOver(() => {
    // Shift the outline down a pixel so only a 1px rim stays highlighted.
    p.poly(body.map(([x, y]) => [x, y + 1]), base);
    if (spec.shadeFrom !== undefined) {
      p.rect(0, spec.shadeFrom, p.canvas.width, 2, shade);
      p.rect(0, spec.shadeFrom + 2, p.canvas.width, 40, shadeDeep || shade);
    }
    if (spec.lower) {
      p.poly(spec.lower, spec.lowerColor);
      p.poly(spec.lower.map(([x, y]) => [x, y + 1]), spec.lowerColorDeep || spec.lowerColor);
    }
  });
}

// ---------------------------------------------------------------------------
// Roadster

const ROADSTER = {
  w: 73,
  h: 20,
  // Wheel centres (sprite px). Wheelbase 46px.
  wheels: [{x: 12, y: 14, r: 6}, {x: 58, y: 14, r: 6}],
  // Gas nozzles sit just inside the wheel wells.
  nozzles: [{x: 12, y: 18, dir: -1}, {x: 58, y: 18, dir: 1}],
};

/**
 * The Roadster in flight mode: wheels retracted, the arches closed over with
 * hatch panels, a cyan light strip along the underside and glowing thruster
 * ports where the wheels were.
 */
function buildRoadsterShip(body) {
  const c = makeCanvas(ROADSTER.w, ROADSTER.h);
  const p = new Painter(c);
  p.ctx.drawImage(body, 0, 0);
  for (const w of ROADSTER.wheels) {
    // Hatch panel over the arch: skirt-coloured, with a lit seam.
    p.onlyOver(() => {
      p.circle(w.x, w.y, 7.2, PALETTE.skirt);
      p.circle(w.x, w.y + 1, 6.2, PALETTE.skirtEdge);
    });
    p.onlyOver(() => {
      for (let a = Math.PI * 1.05; a < Math.PI * 1.95; a += 0.12) {
        p.px(w.x + Math.cos(a) * 7, w.y + Math.sin(a) * 7, '#4a5059');
      }
    });
    // Thruster port glow under the closed arch.
    p.rect(w.x - 3, 17, 6, 1, '#7fe3ff');
    p.rect(w.x - 1, 18, 2, 1, '#d8f7ff');
  }
  // Light strip running the length of the underside.
  p.onlyOver(() => p.rect(4, 17, 64, 1, '#3d8fa8'));
  return c;
}

function buildRoadsterBody() {
  const c = makeCanvas(ROADSTER.w, ROADSTER.h);
  const p = new Painter(c);

  // Long low wedge: chopped tail, straight roof falling back, roof peak just
  // behind a windshield that runs in one line down to a knife-edge nose.
  const body = [
    [0, 4.4], [9.5, 3.0], [20.6, 1.1], [27.3, 0.2], [39, 0], [72, 11.2],
    [73, 12.4], [71.4, 14.6], [69.8, 16.4], [52, 17.4], [36, 18], [20, 17.8],
    [3, 16.8], [1, 14.5], [0.2, 7.4],
  ];
  // Black lower body that rises toward the tail.
  const skirt = [
    [-1, 7.6], [6, 9.4], [17.8, 11.8], [36.1, 13.2], [51.6, 14.2], [66, 14.5],
    [74, 13.2], [74, 21], [-1, 21],
  ];
  paintBody(p, {
    body,
    base: PALETTE.roadsterWhite,
    highlight: PALETTE.roadsterHighlight,
    lower: skirt,
    lowerColor: PALETTE.skirt,
    lowerColorDeep: PALETTE.skirtEdge,
  });

  // Soft curvature: the side darkens just above the skirt line.
  p.onlyOver(() => {
    const band = [
      [-1, 5.6], [6, 7.4], [17.8, 9.8], [36.1, 11.2], [51.6, 12.2], [66, 12.5],
      [74, 11.2], [74, 13.2], [66, 14.5], [51.6, 14.2], [36.1, 13.2],
      [17.8, 11.8], [6, 9.4], [-1, 7.6],
    ];
    p.poly(band, PALETTE.roadsterShade);
  });
  // Re-lay the skirt so the shade band never bleeds into it.
  p.onlyOver(() => {
    p.poly(skirt, PALETTE.skirt);
    p.poly(skirt.map(([x, y]) => [x, y + 1.2]), PALETTE.skirtEdge);
  });

  // Long triangular side glass.
  const glass = [
    [18.6, 2.9], [40.5, 2.3], [55.6, 9.6], [42.8, 8.5], [31.7, 6.1], [20.6, 3.5],
  ];
  const g = new Painter(makeCanvas(ROADSTER.w, ROADSTER.h));
  g.poly(glass, PALETTE.glass);
  g.onlyOver(() => {
    // Reflection streak parallel to the A-pillar.
    g.poly([[33, 0], [36.5, 0], [43, 9], [40, 9]], PALETTE.glassShine);
  });
  p.ctx.drawImage(g.canvas, 0, 0);

  // Door shut line.
  p.line(30, 7, 28.5, 12, PALETTE.roadsterShadeDeep);

  // Wheel wells.
  for (const w of ROADSTER.wheels) {
    p.onlyOver(() => p.circle(w.x, w.y, 7.2, PALETTE.wheelWell));
  }

  // Lights: amber side marker, red tail bar, hidden headlight strip.
  p.rect(50, 10, 4, 1, PALETTE.amber);
  p.px(53, 10, '#ffd08a');
  p.rect(0, 5, 1, 2, PALETTE.red);
  p.rect(1, 8, 3, 1, PALETTE.red);
  p.rect(71, 11, 2, 1, PALETTE.headlight);

  return c;
}

/**
 * Wheel frames: tyre, silver aero disc and five thin spokes with a gold hub.
 * The last frame is a motion-blurred disc for high speed.
 */
function buildWheelFrames(r, style) {
  const size = r * 2;
  const frames = [];
  const count = 6;
  for (let f = 0; f <= count; f++) {
    const c = makeCanvas(size, size);
    const p = new Painter(c);
    const blur = f === count;
    const spin = f / count * (Math.PI * 2 / 5);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x + 0.5 - r;
        const dy = y + 0.5 - r;
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        let color;
        if (d > r - 1.4) {
          color = dy < -r * 0.5 ? style.tyreTop : style.tyre;
        } else if (d > r - 2) {
          color = style.lip;
        } else if (d < 1.1) {
          color = style.hub;
        } else {
          color = style.disc;
          if (blur) {
            color = style.blur;
          } else {
            const a = Math.atan2(dy, dx) - spin;
            for (let k = 0; k < 5; k++) {
              const sa = a - k * Math.PI * 2 / 5;
              // Perpendicular distance from this spoke's ray.
              const along = d * Math.cos(sa);
              const across = Math.abs(d * Math.sin(sa));
              if (along > 0 && across < 0.62) color = style.spoke;
            }
          }
        }
        p.px(x, y, color);
      }
    }
    frames.push(c);
  }
  return frames;
}

const ROADSTER_WHEEL_STYLE = {
  tyre: '#131417', tyreTop: '#24262b', lip: '#5d626b', disc: '#c9cdd4',
  spoke: '#2c2f35', hub: '#c9a25a', blur: '#7c818a',
};

const TRAFFIC_WHEEL_STYLE = {
  tyre: '#101114', tyreTop: '#1f2125', lip: '#3a3e45', disc: '#5a5f68',
  spoke: '#25282d', hub: '#7b8089', blur: '#42464d',
};

// ---------------------------------------------------------------------------
// Traffic

const BODY_TINTS = [
  {base: '#636a74', highlight: '#9199a4', shade: '#4f555e', shadeDeep: '#3d4249'},
  {base: '#80868f', highlight: '#b0b6be', shade: '#676c75', shadeDeep: '#51555c'},
  {base: '#45526a', highlight: '#6e7d96', shade: '#384357', shadeDeep: '#2b3343'},
  {base: '#6b3438', highlight: '#94545a', shade: '#55292d', shadeDeep: '#401f22'},
];

const VEHICLE_SPECS = {
  sedan: {
    w: 78, h: 24, big: false, tinted: true,
    wheels: [{x: 15, y: 18.5, r: 5.5}, {x: 62, y: 18.5, r: 5.5}],
    body: [[0, 9.5], [2, 7.8], [13, 7], [22, 3.2], [32, 0.8], [44, 0.6], [52, 3.4],
      [58, 7.6], [70, 9.4], [76.5, 11.2], [78, 13.5], [77.5, 17], [76, 19.6],
      [2, 19.6], [0.4, 17.5]],
    shadeFrom: 14,
    glass: [[15.5, 7.2], [22.8, 3.6], [32.5, 1.7], [44, 1.6], [51.4, 4.4], [56.2, 7.6]],
    pillars: [37],
    tail: [[0, 9, 2, 2]],
    head: [[76, 11, 2, 1]],
  },
  crossover: {
    w: 80, h: 28, big: false, tinted: true,
    wheels: [{x: 15, y: 22.5, r: 5.5}, {x: 64, y: 22.5, r: 5.5}],
    body: [[0, 12], [1, 6.5], [7, 4.6], [20, 1.4], [44, 0.6], [53, 3], [61, 8.6],
      [73, 10.6], [79, 13], [80, 17], [79, 21.5], [77, 23.6], [2, 23.6], [0.3, 21]],
    shadeFrom: 17,
    glass: [[8, 5.6], [20, 2.4], [44, 1.6], [52.2, 3.8], [58.6, 8.6], [8, 8.8]],
    pillars: [27, 45],
    tail: [[0, 8, 2, 3]],
    head: [[78, 13, 2, 1]],
  },
  cybertruck: {
    w: 96, h: 31, big: true,
    wheels: [{x: 18, y: 24, r: 7}, {x: 77, y: 24, r: 7}],
    body: [[0, 13.5], [1.5, 12.2], [46, 0], [95, 12.6], [96, 14.2], [95.5, 19],
      [94, 24.5], [2, 24.5], [0, 22]],
    colors: {base: '#959ba3', highlight: '#c3c8cf', shade: '#7b8189', shadeDeep: '#646970'},
    shadeFrom: 17,
    lower: [[-1, 21], [97, 21], [97, 26], [-1, 26]],
    angularArches: true,
    glass: [[28, 8.6], [46, 1.8], [68, 7.6], [68, 9.4], [28, 9.4]],
    pillars: [],
    tail: [[0, 13, 2, 1]],
    head: [[93, 12, 3, 1]],
  },
  bus: {
    w: 190, h: 52, big: true,
    wheels: [{x: 32, y: 45, r: 7}, {x: 152, y: 45, r: 7}],
    body: [[0, 4], [3, 1], [184, 1], [188, 3], [190, 8], [190, 42], [188, 46.5],
      [2, 46.5], [0, 43]],
    colors: {base: '#6c737d', highlight: '#9aa1ab', shade: '#575d66', shadeDeep: '#454a52'},
    shadeFrom: 38,
    stripe: {y: 29, h: 2, color: '#8e2c31'},
    windowRow: {y: 9, h: 13, from: 12, to: 162, pitch: 16, w: 13},
    glass: [[178, 6], [187, 6], [189.5, 12], [189.5, 27], [178, 27]],
    door: {x: 166, y: 9, w: 9, h: 34},
    pillars: [],
    tail: [[0, 8, 1, 4], [0, 36, 1, 4]],
    head: [[188, 34, 2, 2]],
    sign: {x: 174, y: 3, w: 12},
  },
  semi: {
    w: 212, h: 62, big: true,
    wheels: [{x: 18, y: 55, r: 7}, {x: 33, y: 55, r: 7}, {x: 162, y: 55, r: 7},
      {x: 177, y: 55, r: 7}, {x: 199, y: 55, r: 7}],
    trailer: {x: 0, y: 2, w: 142, h: 48},
    cab: [[150, 8], [155, 3], [180, 2], [192, 5], [205, 18], [210, 28], [211, 50],
      [209, 54], [150, 54]],
    colors: {base: '#a3a9b1', highlight: '#d1d6dc', shade: '#8a9098', shadeDeep: '#71767e'},
    trailerColors: {base: '#7f858e', highlight: '#a9afb7', rib: '#6e747c'},
    glass: [[183, 6], [191, 6.4], [203, 18.6], [203, 23], [183, 23]],
    pillars: [],
    tail: [[0, 44, 1, 3]],
    head: [[207, 40, 4, 1]],
  },
};

function buildVehicle(name, tint) {
  const spec = VEHICLE_SPECS[name];
  const colors = spec.colors || tint;
  const c = makeCanvas(spec.w, spec.h);
  const p = new Painter(c);

  if (spec.trailer) {
    const t = spec.trailer;
    const tc = spec.trailerColors;
    p.rect(t.x, t.y, t.w, t.h, tc.highlight);
    p.rect(t.x, t.y + 1, t.w, t.h - 1, tc.base);
    for (let x = t.x + 10; x < t.x + t.w - 4; x += 12) p.rect(x, t.y + 2, 1, t.h - 4, tc.rib);
    p.rect(t.x, t.y + t.h - 3, t.w, 3, '#55595f');
    // Under-run frame and the gap to the tractor.
    p.rect(4, t.y + t.h, 140, 3, '#2a2c31');
    p.rect(140, 40, 12, 8, '#2a2c31');
    // Marker lights along the trailer side.
    for (let x = t.x + 6; x < t.x + t.w; x += 22) p.px(x, t.y + t.h - 2, '#ff8a3a');
    paintBody(p, {body: spec.cab, ...colors, shadeFrom: 40});
  } else {
    paintBody(p, {
      body: spec.body,
      ...colors,
      shadeFrom: spec.shadeFrom,
      lower: spec.lower,
      lowerColor: '#2b2e33',
      lowerColorDeep: '#202226',
    });
  }

  if (spec.stripe) p.rect(1, spec.stripe.y, spec.w - 2, spec.stripe.h, spec.stripe.color);
  if (spec.windowRow) {
    const r = spec.windowRow;
    for (let x = r.from; x + r.w <= r.to; x += r.pitch) {
      p.rect(x, r.y, r.w, r.h, PALETTE.glass);
      p.rect(x + 1, r.y + 1, 3, 1, PALETTE.glassShine);
    }
  }
  if (spec.door) {
    const d = spec.door;
    p.rect(d.x, d.y, d.w, d.h, PALETTE.glass);
    p.rect(d.x + Math.floor(d.w / 2), d.y, 1, d.h, colors.shade);
  }
  if (spec.sign) {
    p.rect(spec.sign.x, spec.sign.y, spec.sign.w, 3, '#1a1c20');
    for (let x = 1; x < spec.sign.w - 1; x += 2) p.px(spec.sign.x + x, spec.sign.y + 1, PALETTE.amber);
  }
  if (spec.glass) {
    // Paint the glass on its own layer so the shine and pillars stay inside it.
    const g = new Painter(makeCanvas(spec.w, spec.h));
    g.poly(spec.glass, PALETTE.glass);
    g.onlyOver(() => {
      const gx = spec.glass[1][0];
      g.poly([[gx + 3, 0], [gx + 6, 0], [gx + 12, 12], [gx + 9, 12]], PALETTE.glassShine);
      for (const x of spec.pillars) g.rect(x, 0, 1, spec.h, colors.base);
    });
    p.ctx.drawImage(g.canvas, 0, 0);
  }

  for (const w of spec.wheels) {
    if (spec.angularArches) {
      p.onlyOver(() => p.poly([[w.x - 10, 25], [w.x - 7, w.y - 9], [w.x + 7, w.y - 9],
        [w.x + 10, 25]], PALETTE.wheelWell));
    } else {
      p.onlyOver(() => p.circle(w.x, w.y, w.r + 1.4, PALETTE.wheelWell));
    }
  }

  for (const [x, y, w, h] of spec.tail) p.rect(x, y, w, h, PALETTE.red);
  for (const [x, y, w, h] of spec.head) p.rect(x, y, w, h, '#fff1d0');

  return c;
}

/** Row of the first opaque pixel in each column (h when the column is empty). */
function topProfile(canvas) {
  const {width: w, height: h} = canvas;
  const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const top = new Array(w).fill(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (data[(y * w + x) * 4 + 3] > 0) { top[x] = y; break; }
    }
  }
  return top;
}

/** Row just below the last opaque pixel in each column (0 when empty). */
function bottomProfile(canvas) {
  const {width: w, height: h} = canvas;
  const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const bottom = new Array(w).fill(0);
  for (let x = 0; x < w; x++) {
    for (let y = h - 1; y >= 0; y--) {
      if (data[(y * w + x) * 4 + 3] > 0) { bottom[x] = y + 1; break; }
    }
  }
  return bottom;
}

// ---------------------------------------------------------------------------
// Logo, icons, sky

// Pixel Tesla "T".
const TESLA_LOGO = [
  '..###########..',
  '##...........##',
  '...............',
  '###############',
  '####..###..####',
  '#.....###.....#',
  '......###......',
  '......###......',
  '......###......',
  '......###......',
  '......###......',
  '.......#.......',
];

// Circular "play again" arrow.
const RESTART_ICON = [
  '...####.#',
  '.##....##',
  '#.....###',
  '#........',
  '#.......#',
  '#.......#',
  '.#.....#.',
  '..#####..',
];

const ARROW_LEFT = [
  '...#.....',
  '..##.....',
  '.########',
  '#########',
  '.########',
  '..##.....',
  '...#.....',
];

// Touch-key legends: the jump arrow, and a tiny Roadster for the flip keys.
const ARROW_UP = [
  '.......#.......',
  '......###......',
  '.....#####.....',
  '....#######....',
  '...#########...',
  '..###########..',
  '.#############.',
  '###############',
  '.....#####.....',
  '.....#####.....',
  '.....#####.....',
  '.....#####.....',
  '.....#####.....',
  '.....#####.....',
];

const FLIP_CAR = [
  '.....####....',
  '...#######...',
  '############.',
  '#############',
  '.###....###..',
  '..#......#...',
];

// A tiny camera glyph for the Instagram credit.
const INSTAGRAM_ICON = [
  '.#####.',
  '#....##',
  '#.###.#',
  '#.#.#.#',
  '#.###.#',
  '#.....#',
  '.#####.',
];

const ARROW_DOWN = [
  '..#..',
  '..#..',
  '..#..',
  '#####',
  '.###.',
  '..#..',
];

// Overhead highway sign gantry, drawn in oblique perspective: depth into the
// road moves things right by `skew` and down the screen by the road's depth.
// Two legs (far curb and near shoulder) carry a truss beam across the road;
// the green board hangs from it across the lanes. Positions are depth z
// (0 = far curb, 1 = near edge) and height above the road.
const GANTRY = {
  clearance: 14,      // px from the road to the bottom of the board
  postHeight: 72,     // px from the road to the top of the truss: just above
                      // a Semi, so a double tap clears it
  beam: 4,            // a slim truss
  skew: 60,           // px the structure shifts right from far curb to near edge
  farLeg: -0.15,      // depth of the far leg (on the far verge)
  nearLeg: 1.12,      // depth of the near leg (on the near shoulder)
  z1: 0.04,           // the board spans these depths
  z2: 0.96,
  names: ['GILBERT', 'READING', 'FREMONT', 'STARBASE', 'GIGA TX', 'AUSTIN', 'MARS', 'BOCA'],
};

/**
 * The board's face, painted upright; the game shears it into perspective.
 * "EXIT n", the destination, a down arrow and a yellow ONLY strip.
 */
function buildGantry(name, exit) {
  const w = Math.round(GANTRY.skew * (GANTRY.z2 - GANTRY.z1));
  const h = GANTRY.postHeight - GANTRY.beam - GANTRY.clearance;
  const c = makeCanvas(w, h);
  const p = new Painter(c);
  const green = '#1d5a39';
  const white = '#d9e8de';
  const text = '#eef5f0';
  const ink = '#1d1b10';
  const arrow = (x, y, color) => p.bitmap(ARROW_DOWN.map((r) => r.replace(/#/g, 'k')), x, y, {k: color});

  p.rect(0, 0, w, h, green);
  p.rect(1, 1, w - 2, 1, white);
  p.rect(1, h - 16, w - 2, 1, white);
  p.rect(1, 2, 1, h - 18, white);
  p.rect(w - 2, 2, 1, h - 18, white);
  drawText(p.ctx, `EXIT ${exit}`, w / 2, 4, text, 1, 'center');
  p.rect(6, 13, w - 12, 1, '#2f7a50');
  drawText(p.ctx, name, w / 2, 16, text, 1, 'center');
  arrow(Math.floor(w / 2) - 2, 27, text);

  // Yellow strip along the bottom.
  p.rect(0, h - 15, w, 15, '#d8b13a');
  p.rect(0, h - 1, w, 1, '#a9862a');
  drawText(p.ctx, 'ONLY', w / 2, h - 11, ink, 1, 'center');
  arrow(4, h - 11, ink);
  arrow(w - 9, h - 11, ink);
  return c;
}

function buildBitmap(rows, color, scale = 1) {
  const c = makeCanvas(rows[0].length * scale, rows.length * scale);
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      if (row[i] === '#') ctx.fillRect(i * scale, j * scale, scale, scale);
    }
  });
  return c;
}

/**
 * Flip-key legend: the car inside a ring arrow. For a backflip (dir -1) the
 * ring turns anticlockwise and its arrowhead rises at the nose; a front
 * flip mirrors the ring, so the arrowhead rises at the tail. The car always
 * faces right, as in the game.
 */
function buildFlipIcon(dir, ringColor, carColor) {
  const ring = makeCanvas(24, 22);
  const p = new Painter(ring);
  const cx = 12;
  const cy = 11;
  const r = 8.5;
  // Angles grow clockwise from 3 o'clock. The ring runs anticlockwise from
  // its tail near 12 o'clock round to its head just above 3 o'clock.
  const tail = -80 * Math.PI / 180;
  const head = -10 * Math.PI / 180;
  for (let y = 0; y < ring.height; y++) {
    for (let x = 0; x < ring.width; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      if (d >= r - 1 && d <= r + 1 && !(a > tail && a < head)) p.px(x, y, ringColor);
    }
  }
  const hx = cx + r * Math.cos(head);
  const hy = cy + r * Math.sin(head);
  const tx = Math.sin(head);
  const ty = -Math.cos(head);
  const nx = Math.cos(head);
  const ny = Math.sin(head);
  p.poly([[hx + tx * 4, hy + ty * 4], [hx + nx * 3.2, hy + ny * 3.2], [hx - nx * 3.2, hy - ny * 3.2]], ringColor);

  const icon = dir < 0 ? ring : mirrorCanvas(ring);
  icon.getContext('2d').drawImage(buildBitmap(FLIP_CAR, carColor), 6, 8);
  return icon;
}

/** The credit tag's contents: camera glyph, MADE BY, then the handle. */
function buildCredit() {
  const lead = 'MADE BY ';
  const handle = '@_SEARCHR_';
  const c = makeCanvas(INSTAGRAM_ICON[0].length + 4 + textWidth(lead + handle), 7);
  const ctx = c.getContext('2d');
  ctx.drawImage(buildBitmap(INSTAGRAM_ICON, '#dfe2e6'), 0, 0);
  const x = INSTAGRAM_ICON[0].length + 4;
  drawText(ctx, lead, x, 0, '#8a9099');
  drawText(ctx, handle, x + textWidth(lead), 0, '#dfe2e6');
  return c;
}

function buildMoon() {
  const c = makeCanvas(14, 14);
  const p = new Painter(c);
  p.circle(7, 7, 6.6, '#d9dde3');
  p.onlyOver(() => {
    p.circle(5.5, 6, 2, '#bfc4cb');
    p.circle(9, 10, 1.3, '#c6cbd1');
  });
  p.erase(() => p.circle(11, 5.5, 5.8, '#000'));
  return c;
}

/** Everything the game draws, painted once. */
function buildSprites() {
  const roadsterBody = buildRoadsterBody();
  const roadsterWheels = buildWheelFrames(6, ROADSTER_WHEEL_STYLE);
  const roadsterBottom = bottomProfile(roadsterBody);
  // The wheels reach the ground; fold them into the underside profile.
  for (const w of ROADSTER.wheels) {
    for (let x = w.x - w.r; x < w.x + w.r; x++) {
      const dx = x + 0.5 - w.x;
      const half = Math.sqrt(Math.max(0, w.r * w.r - dx * dx));
      roadsterBottom[x] = Math.max(roadsterBottom[x], Math.ceil(w.y + half - 0.01));
    }
  }

  const vehicles = {};
  for (const name of Object.keys(VEHICLE_SPECS)) {
    const spec = VEHICLE_SPECS[name];
    const tints = spec.tinted ? BODY_TINTS : [null];
    vehicles[name] = tints.map((tint) => {
      const canvas = buildVehicle(name, tint);
      return {canvas, top: topProfile(canvas)};
    });
  }

  return {
    roadsterBody,
    roadsterShip: buildRoadsterShip(roadsterBody),
    roadsterWheels,
    roadsterBottom,
    trafficWheels: {
      5.5: buildWheelFrames(5.5, TRAFFIC_WHEEL_STYLE),
      7: buildWheelFrames(7, TRAFFIC_WHEEL_STYLE),
    },
    vehicles,
    logo: buildBitmap(TESLA_LOGO, PALETTE.teslaRed),
    logoWhite: buildBitmap(TESLA_LOGO, '#f2f3f5'),
    restart: buildBitmap(RESTART_ICON, '#f2f3f5', 2),
    restartDark: buildBitmap(RESTART_ICON, '#0b0c0f', 2),
    moon: buildMoon(),
    gantries: GANTRY.names.map((name, i) => buildGantry(name, (i * 3) % 9 + 1)),
    arrowLeft: buildBitmap(ARROW_LEFT, '#15171c'),
    arrowRight: mirrorCanvas(buildBitmap(ARROW_LEFT, '#15171c')),
    credit: buildCredit(),
    // Legends for the on-screen keys of the phone layout.
    keyIcons: {
      back: buildFlipIcon(-1, '#ffa53d', '#dfe2e6'),
      jump: buildBitmap(ARROW_UP, '#f2f3f5'),
      front: buildFlipIcon(1, '#7fe3ff', '#dfe2e6'),
    },
  };
}

/** Pixel Tesla "T" favicon. */
function setFavicon() {
  const c = makeCanvas(32, 32);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b0c0f';
  ctx.fillRect(0, 0, 32, 32);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(buildBitmap(TESLA_LOGO, PALETTE.teslaRed, 2), 1, 4);
  const link = document.createElement('link');
  link.rel = 'icon';
  link.href = c.toDataURL('image/png');
  document.head.appendChild(link);
}

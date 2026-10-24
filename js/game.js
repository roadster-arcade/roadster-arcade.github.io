// Roadster: the game. Physics runs at a fixed 120 steps a second; drawing
// runs at the display's rate. All drawing happens on a small, low-resolution
// canvas that fills the window and is scaled up with nearest-neighbour
// sampling, so everything stays pixel art, including the gas.
'use strict';

// The view is at least 640 game pixels wide and as tall as the window's
// shape allows; setViewSize() recomputes these whenever the window resizes.
// The road always sits at the bottom.
const MIN_VIEW_W = 640;
const MIN_VIEW_H = 270;
let VIEW_W = MIN_VIEW_W;
let VIEW_H = MIN_VIEW_H;
let GROUND_Y;                // where the wheels touch: the middle of our lane
let ROAD_FAR;                // far curb; the road runs from here down
let ROAD_NEAR;               // near edge line, then the shoulder
let UI_Y;                    // shifts menus down to centre them in tall views
let BUTTON;
let SHARE_BTN;
// Text and menus are drawn UI_ZOOM times larger than the world (2 on
// phones, whose screen is small), in a space UI_W pixels wide.
let UI_ZOOM = 1;
let UI_W = MIN_VIEW_W;

function setViewSize(w, h, zoom = 1) {
  VIEW_W = w;
  VIEW_H = h;
  GROUND_Y = h - 38;
  ROAD_FAR = GROUND_Y - 18;
  ROAD_NEAR = GROUND_Y + 25;
  UI_ZOOM = zoom;
  UI_W = w / zoom;
  // Phones skip the controls panels, so their menus are shorter.
  UI_Y = Math.round((GROUND_Y / zoom - (zoom > 1 ? 190 : 232)) / 2);
  BUTTON = {x: Math.round(UI_W / 2 - 88), y: 138 + UI_Y, w: 176, h: 34};
  SHARE_BTN = {x: Math.round(UI_W / 2 - 45), y: 204 + UI_Y, w: 90, h: 14};
}
setViewSize(MIN_VIEW_W, MIN_VIEW_H);

const PLAYER_X = 96;         // left edge of the Roadster on screen
const STEP_DT = 1 / 120;
const STEP = 7;              // tallest ledge the car can roll straight up
const HISCORE_KEY = 'roadster.hiscore';

const TUNING = {
  speedStart: 330,           // px/s, shown as 60 mph
  speedMax: 780,             // px/s, shown as 250 mph
  accel: 5,                  // px/s gained every second
  trafficRel: 0.85,          // traffic drives forward at 15% of our speed
  gravity: 1500,
  // A tap fires a short thruster burn whose push swells and fades (a sine
  // over liftTime) instead of an instant kick, so the car lifts off
  // smoothly. Sized to reach car roofs, not truck roofs.
  liftTime: 0.2,
  liftAccel: 3580,           // peaks about 45px up: car roofs, not trucks
  // The second tap in the air: a bigger burn, for trucks and buses.
  boostLiftTime: 0.24,
  boostLiftAccel: 3750,      // a double tap peaks about 100px up
  holdDelay: 0.14,           // a press longer than this is a hold, not a tap
  thrust: 2450,              // holding: upward push, stronger than gravity
  maxClimb: 230,             // fastest climb while holding
  liftPitch: 0.14,           // rad (about 8°): how far the tail rises first on lift-off
  // Landing burn: falling, the thrusters hold the descent to a safe speed
  // that shrinks as the road gets closer, down to touchdownSpeed.
  touchdownSpeed: 70,
  flareSlope: 4,             // px/s of allowed speed per px of height
  flareGain: 45,
  flareBrake: 4500,
  dive: 2200,                // holding Down
  ceiling: 44,               // keeps a car mid-flip fully on screen
  // Nitrogen tank, 0..1.
  tank: {jump: 0.05, boost: 0.16, hold: 0.42, refill: 0.34, flip: 0.1, relift: 0.08},
  gasRate: 950,              // particles a second per nozzle at full thrust
  // Flips. Each tap of Left queues one full backflip, each tap of Right one
  // front flip; the car spins itself round and stops upright.
  flipRate: 15,              // rad/s top spin: a full flip in about 0.45s
  flipGain: 12,              // eases the spin out as it nears upright
  flipResponse: 18,
  flipLaunch: 220,           // tapping a flip on the road hops about a car's height
  flipAssist: 0.3,           // while spinning, the thrusters carry 70% of the weight
  // Letting go of the arrow: a springy settle to the nearest upright that
  // overshoots and wobbles a little, like the thrusters catching the car.
  settleSpring: 170,
  settleDamp: 9,
  landTolerance: 0.8,        // rad (about 46°): land more crooked and you crash
  // Boost: the meter charges with every point you earn yourself and is full
  // after boostUnlock points (counting again from each landing). Only a full
  // meter can be fired, by a double tap of Space. The car climbs above
  // traffic and flies at boostMultiplier x speed, scoring boostScoreRate x
  // points, until it has earned boostPoints; then it slows to normal speed
  // and lands on a clear road.
  boostUnlock: 750,
  gantryFrom: 250,           // overhead signs start appearing past this score,
  gantryPeakUntil: 600,      // come up most often until here,
  gantryRareFrom: 2000,      // and turn rarer past this
  boostPoints: 500,
  boostMultiplier: 2.5,
  boostSpeedMax: 1500,       // px/s, about 560 mph
  boostScoreRate: 3,
  boostAltitude: 145,        // cruising height of the wheels: clears the gantries
  doubleTapWindow: 0.35,     // seconds between taps
};

const TAU = Math.PI * 2;

// Points for n flips in one jump. Doubles pay more than two singles.
const FLIP_POINTS = {back: [0, 100, 300, 600], front: [0, 75, 200, 400]};
const FLIP_COUNT_WORDS = ['', '', 'DOUBLE ', 'TRIPLE ', 'QUAD '];

function flipAward(kind, n) {
  const table = FLIP_POINTS[kind];
  const points = n < table.length ? table[n] : table[table.length - 1] + (n - table.length + 1) * 400;
  const word = n < FLIP_COUNT_WORDS.length ? FLIP_COUNT_WORDS[n] : `${n}X `;
  return {label: word + (kind === 'back' ? 'BACKFLIP' : 'FRONT FLIP'), points};
}

/** Angle wrapped to -PI..PI. */
function wrapAngle(a) {
  return a - Math.round(a / TAU) * TAU;
}

// Gas colours, from bright cyan-white at the nozzle to cool grey vapour,
// with alpha in 16 steps. Precomputed so drawing allocates no strings.
const GAS_STYLES = [];
for (let c = 0; c < 8; c++) {
  const t = c / 7;
  const r = Math.round(lerp(238, 150, t));
  const g = Math.round(lerp(251, 163, t));
  const b = Math.round(lerp(255, 180, t));
  GAS_STYLES.push([]);
  for (let a = 0; a < 16; a++) GAS_STYLES[c].push(`rgba(${r},${g},${b},${(a / 15).toFixed(3)})`);
}

// After a flip lands, its points hold under the label, then glide up into
// the score and are added when they arrive (seconds after touchdown).
const TRICK_GLIDE_START = 0.4;
const TRICK_GLIDE_END = 1.05;

// Point the car rotates about, relative to its sprite.
const PIVOT = {x: 36, y: 12};

// Tail thruster, under the rear light bar like the reveal car's nozzles.
const REAR_NOZZLE = {x: 0, y: 9};

/** Small seeded random generator so the skyline is the same every load. */
function seeded(seed) {
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function loadHighScore() {
  try {
    return Number(localStorage.getItem(HISCORE_KEY)) || 0;
  } catch (e) {
    return 0;
  }
}

function saveHighScore(value) {
  try {
    localStorage.setItem(HISCORE_KEY, String(value));
  } catch (e) {
    // Private windows can block storage; the score just won't persist.
  }
}

class Game {
  constructor(canvas, button, liveRegion) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.paint = new Painter(canvas);
    this.button = button || document.getElementById('play-again');
    if (!this.button) {
      this.button = document.createElement('button');
      this.button.id = 'play-again';
      this.button.type = 'button';
      this.button.textContent = 'Play again';
      this.button.hidden = true;
      if (this.canvas && this.canvas.parentElement) {
        this.canvas.parentElement.appendChild(this.button);
      }
    }
    this.liveRegion = liveRegion;
    this.sprites = buildSprites();
    this.sound = new Sound();
    this.hiScore = loadHighScore();
    // spin: -1 while Left is held, 1 while Right is held, else 0.
    this.input = {held: false, heldFor: 0, down: false, spin: 0};
    this.clock = 0;
    this.state = 'title';
    this.gas = [];
    this.sparks = [];
    this.streaks = [];
    this.texts = [];
    this.gasCarry = [0, 0];
    this.buttonHover = false;
    this.buttonFocus = false;
    this.shareButton = document.getElementById('share');
    if (!this.shareButton) {
      this.shareButton = document.createElement('button');
      this.shareButton.id = 'share';
      this.shareButton.type = 'button';
      this.shareButton.textContent = 'Share score';
      this.shareButton.hidden = true;
      if (this.canvas && this.canvas.parentElement) {
        this.canvas.parentElement.appendChild(this.shareButton);
      }
    }
    this.shareHover = false;
    this.shareFocus = false;
    this.shareCopied = 0;
    this.challengeScore = this.parseChallenge();
    this.timeScale = 1;
    this.slowMo = 0;
    // The phone layout: an enlarged HUD above the screen and three keys
    // below it. The disclaimer note shows in both layouts.
    this.handheld = false;
    this.console = document.getElementById('console');
    this.hud = document.getElementById('hud');
    this.screenFrame = document.getElementById('frame');
    this.pad = document.getElementById('pad');
    this.hudCtx = this.hud.getContext('2d');
    this.note = document.getElementById('note-text');
    this.credit = document.getElementById('credit');
    this.keys = {};
    for (const el of document.querySelectorAll('.key')) this.keys[el.dataset.key] = el;
    // Touches holding the screen or the jump key; the jump is held while any is.
    this.jumpPointers = new Set();

    this.reset();
    this.bindInput();
    this.bindKeys();
    this.bindLandscapeKeys();
    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.last = performance.now();
    this.acc = 0;
    requestAnimationFrame((t) => this.frame(t));
  }

  reset() {
    // baseSpeed climbs with play time and sets the difficulty; speed is what
    // the world actually scrolls at (base speed times any boost).
    this.baseSpeed = TUNING.speedStart;
    this.speed = TUNING.speedStart;
    this.boostFactor = 1;
    this.cruise = null;          // the boost autopilot while it runs
    this.boostReady = false;
    this.boostChargeFrom = 0;    // score where the meter last started filling
    this.boostReadyAt = TUNING.boostUnlock;
    this.playTime = 0;
    this.lastTapAt = -1;
    this.distance = 0;
    this.bonus = 0;
    this.score = 0;
    this.nextMilestone = 100;
    this.nextMph = 100;
    this.vehicles = [];
    // Overhead sign gantries: fixed to the road, so they come at full speed.
    this.structures = [];
    this.spawnIn = 560;
    this.shake = 0;
    this.scoreFlash = 0;
    this.banner = null;
    this.trick = null;
    this.crashTime = 0;
    this.overTime = 0;
    this.newBest = false;
    this.player = {
      y: GROUND_Y, vy: 0, grounded: true, on: null, lastRoof: null,
      canBoost: false, tank: 1, thrust: 0, tilt: 0, sputter: false,
      // angle grows clockwise (nose down) and is not wrapped mid-air, so it
      // counts whole flips. jets: per-nozzle visual level [rear, front].
      angle: 0, angVel: 0, targetAngle: 0, flips: 0, jets: [0, 0],
      // tapTarget: the flips committed by taps, which letting go never undoes.
      // wobble: leftover tilt after a crooked landing, rocking back to level.
      tapTarget: 0, wobble: 0, wobbleVel: 0,
      rearJet: 0,                // tail thruster level, used while boosting
      lift: null,                // the running lift burn after a tap
      // Boost only: how far the car has surged right of its usual spot, and
      // gear, 0 wheels down .. 1 wheels retracted (flight mode).
      xOff: 0, xVel: 0, gear: 0,
      bodyOff: 0, bodyVel: 0, wheelAngle: 0, wheelSpin: 0,
      coyote: 0, buffer: 0, support: GROUND_Y,
    };
  }

  get progress() {
    return clamp((this.baseSpeed - TUNING.speedStart) / (TUNING.speedMax - TUNING.speedStart), 0, 1);
  }

  /** Grows with speed: jumps and thrust get quicker the faster you go. */
  get k() {
    return 1 + 0.3 * this.progress;
  }

  /** The speedometer: the speed you are actually going, boost included. */
  get mph() {
    return Math.max(0, Math.round(60 + (this.speed - TUNING.speedStart) /
        (TUNING.speedMax - TUNING.speedStart) * 190));
  }

  /** Where the car is drawn: its usual spot, plus the boost surge. */
  get carX() {
    return PLAYER_X + this.player.xOff;
  }

  /** Cruising speed without boost, for the speed-up banners. */
  get baseMph() {
    return Math.round(60 + this.progress * 190);
  }

  // -------------------------------------------------------------------------
  // Input

  bindInput() {
    const jumpKeys = ['Space', 'ArrowUp', 'KeyW'];
    const downKeys = ['ArrowDown', 'KeyS'];
    const leftKeys = ['ArrowLeft', 'KeyA'];
    const rightKeys = ['ArrowRight', 'KeyD'];
    window.addEventListener('keydown', (e) => {
      if (jumpKeys.includes(e.code)) {
        e.preventDefault();
        this.showKey('jump', true);
        if (!e.repeat) this.press();
      } else if (downKeys.includes(e.code)) {
        e.preventDefault();
        this.input.down = true;
      } else if (leftKeys.includes(e.code) || rightKeys.includes(e.code)) {
        e.preventDefault();
        if (e.repeat) return;
        const dir = leftKeys.includes(e.code) ? -1 : 1;
        this.showKey(dir < 0 ? 'back' : 'front', true);
        this.input.spin = dir;
        this.flip(dir);
      } else if (e.code === 'Enter' && this.state === 'over' && e.target !== this.button &&
          e.target !== this.credit) {
        this.restart();
      } else if (e.code === 'KeyM') {
        this.sound.start();
        this.muted = this.sound.toggleMute();
      } else if ((e.code === 'KeyP' || e.code === 'Escape') && this.state === 'playing') {
        this.pause();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (jumpKeys.includes(e.code)) {
        this.showKey('jump', false);
        this.release();
      }
      if (downKeys.includes(e.code)) this.input.down = false;
      const dir = leftKeys.includes(e.code) ? -1 : rightKeys.includes(e.code) ? 1 : 0;
      if (dir) this.showKey(dir < 0 ? 'back' : 'front', false);
      if (dir && this.input.spin === dir) this.releaseSpin();
    });

    const stage = this.canvas.parentElement;
    stage.addEventListener('pointerdown', (e) => {
      if (e.target === this.button || e.target === this.shareButton) return;
      if (this.state === 'over') {
        const rect = this.canvas.getBoundingClientRect();
        const s = this.cssScale * UI_ZOOM;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const bx = SHARE_BTN.x * s;
        const by = SHARE_BTN.y * s;
        const bw = SHARE_BTN.w * s;
        const bh = SHARE_BTN.h * s;
        if (x >= bx - 10 && x <= bx + bw + 10 && y >= by - 8 && y <= by + bh + 8) {
          e.preventDefault();
          e.stopPropagation();
          this.shareScore();
          return;
        }
      }
      e.preventDefault();
      this.jumpPointers.add(e.pointerId);
      this.press();
    });
    // Each finger lets go on its own: lifting one off a flip key must not
    // end a jump another finger is still holding.
    const letGo = (e) => {
      if (this.jumpPointers.delete(e.pointerId) && !this.jumpPointers.size) this.release();
    };
    window.addEventListener('pointerup', letGo);
    window.addEventListener('pointercancel', letGo);
    // iOS only lets sound start when a touch ends, not when it begins.
    window.addEventListener('touchend', () => this.sound.start());

    if (this.button) {
      this.button.addEventListener('click', (e) => {
        e.stopPropagation();
        this.restart();
      });
      this.button.addEventListener('pointerenter', () => { this.buttonHover = true; });
      this.button.addEventListener('pointerleave', () => { this.buttonHover = false; });
      this.button.addEventListener('focus', () => { this.buttonFocus = true; });
      this.button.addEventListener('blur', () => { this.buttonFocus = false; });
    }

    if (this.shareButton) {
      this.shareButton.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
      });
      this.shareButton.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.shareScore();
      });
      this.shareButton.addEventListener('pointerenter', () => { this.shareHover = true; });
      this.shareButton.addEventListener('pointerleave', () => { this.shareHover = false; });
      this.shareButton.addEventListener('focus', () => { this.shareFocus = true; });
      this.shareButton.addEventListener('blur', () => { this.shareFocus = false; });
    }

    window.addEventListener('blur', () => {
      this.jumpPointers.clear();
      this.release();
      this.input.down = false;
      if (this.input.spin) this.releaseSpin();
      if (this.state === 'playing') this.pause();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
  }

  press() {
    this.sound.start();
    this.input.held = true;
    this.input.heldFor = 0;
    switch (this.state) {
      case 'title':
        this.startRun();
        break;
      case 'playing':
        if (this.cruise) break;
        if (this.boostReady && this.playTime - this.lastTapAt < TUNING.doubleTapWindow) {
          this.startCruise();
          break;
        }
        this.lastTapAt = this.playTime;
        this.player.buffer = 0.12;
        break;
      case 'paused':
        this.state = 'playing';
        this.input.held = false;
        break;
      case 'over':
        if (this.overTime > 0.6) this.restart();
        break;
    }
  }

  release() {
    this.input.held = false;
  }

  /**
   * The phone layout's keys: Jump works like Space (tap, double tap, hold);
   * the flip keys like the arrows (tap for one flip, hold to keep flipping).
   * Outside a run any key starts, resumes or restarts, like Space.
   */
  bindKeys() {
    for (const [kind, el] of Object.entries(this.keys)) {
      const dir = kind === 'back' ? -1 : kind === 'front' ? 1 : 0;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        this.showKey(kind, true);
        if (navigator.vibrate) navigator.vibrate(8);
        if (!dir) {
          this.jumpPointers.add(e.pointerId);
          this.press();
        } else if (this.state !== 'playing') {
          this.press();
          this.release();
        } else {
          this.input.spin = dir;
          this.flip(dir);
        }
      });
      const up = () => {
        this.showKey(kind, false);
        if (dir && this.input.spin === dir) this.releaseSpin();
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  showKey(kind, down) {
    if (this.keys[kind]) this.keys[kind].classList.toggle('down', down);
  }

  /**
   * Landscape-mobile overlay: two round flip buttons side-by-side in a pill
   * container, on one edge of the screen (left by default). A small toggle
   * arrow lets the player move them to the other side; the choice is saved.
   */
  bindLandscapeKeys() {
    const pad = document.getElementById('landscape-pad');
    const opts = document.querySelectorAll('.ls-opt');
    // Apply a side: move pad, highlight the active option.
    const applySide = (side) => {
      const goRight = side === 'right';
      pad.classList.toggle('right-side', goRight);
      opts.forEach((o) => o.classList.toggle('active', o.dataset.side === side));
      try { localStorage.setItem('roadster.flipSide', side); } catch (_) {}
    };
    // Restore saved side preference (right by default).
    applySide(localStorage.getItem('roadster.flipSide') || 'right');
    // Wire each option button.
    for (const opt of opts) {
      opt.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        applySide(opt.dataset.side);
      });
      opt.addEventListener('pointerdown', (e) => {
        e.stopPropagation();        // don't trigger jump
      });
    }
    // Wire each flip button.
    for (const el of document.querySelectorAll('.ls-flip')) {
      const kind = el.dataset.lsKey;             // 'back' or 'front'
      const dir = kind === 'back' ? -1 : 1;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.setPointerCapture(e.pointerId);
        el.classList.add('active');
        if (navigator.vibrate) navigator.vibrate(8);
        if (this.state !== 'playing') {
          this.press();
          this.release();
        } else {
          this.input.spin = dir;
          this.flip(dir);
        }
      });
      const up = () => {
        el.classList.remove('active');
        if (dir && this.input.spin === dir) this.releaseSpin();
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  pause() {
    this.state = 'paused';
    this.sound.setThrust(0);
    this.sound.setMotor(this.progress, false);
  }

  startRun() {
    this.reset();
    this.gas.length = 0;
    this.sparks.length = 0;
    this.texts.length = 0;
    this.state = 'playing';
    this.input.held = false;
    if (this.button) this.button.hidden = true;
    if (this.shareButton) this.shareButton.hidden = true;
    this.announce('Game started. Space to jump, tap again to boost, hold to fly. ' +
        'Left arrow backflips, right arrow front flips.');
  }

  restart() {
    this.sound.click();
    this.startRun();
    this.canvas.parentElement.focus();
  }

  announce(text) {
    this.liveRegion.textContent = text;
  }

  // -------------------------------------------------------------------------
  // Loop

  frame(now) {
    const realDt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.clock += realDt;
    if (this.slowMo > 0) {
      this.slowMo -= realDt;
      this.timeScale = this.slowMo > 0 ? 0.35 : 1;
    }
    this.acc += realDt * this.timeScale;
    while (this.acc >= STEP_DT) {
      this.update(STEP_DT);
      this.acc -= STEP_DT;
    }
    this.render();
    requestAnimationFrame((t) => this.frame(t));
  }

  update(dt) {
    if (this.state === 'paused') return;
    const playing = this.state === 'playing';

    if (playing) {
      this.playTime += dt;
      this.baseSpeed = Math.min(TUNING.speedMax, this.baseSpeed + TUNING.accel * dt);
      this.speed = this.baseSpeed * this.boostFactor;
    } else if (this.state === 'crashed' || this.state === 'over') {
      this.speed *= Math.exp(-4 * dt);
      if (this.speed < 2) this.speed = 0;
    } else {
      this.speed = 0;
    }
    this.distance += this.speed * dt;

    this.updateVehicles(dt);
    if (playing) {
      if (this.cruise) this.updateCruise(dt);
      else this.updatePlayer(dt);
      this.spawn(dt);
      this.updateScore();
    } else if (this.state !== 'title') {
      this.updateWreck(dt);
    }
    this.updateParticles(dt);
    this.updateTrick(dt);

    this.shake *= Math.exp(-7 * dt);
    this.scoreFlash = Math.max(0, this.scoreFlash - dt);
    this.shareCopied = Math.max(0, this.shareCopied - dt);
    if (this.banner) {
      this.banner.age += dt;
      if (this.banner.age > 1.6) this.banner = null;
    }
    if (this.state === 'crashed') {
      this.crashTime += dt;
      if (this.crashTime > 0.9) this.gameOver();
    } else if (this.state === 'over') {
      this.overTime += dt;
    }

    this.sound.setThrust(this.state === 'playing' ? this.player.thrust : 0);
    this.sound.setMotor(clamp((this.speed - TUNING.speedStart) / (TUNING.speedMax - TUNING.speedStart), 0, 2), playing);
  }

  // -------------------------------------------------------------------------
  // Player

  updatePlayer(dt) {
    const p = this.player;
    const T = TUNING;
    const k = this.k;
    const g = T.gravity * k * k;
    if (this.input.held) this.input.heldFor += dt;

    if (p.buffer > 0) {
      if (p.grounded || p.coyote > 0) this.jump();
      else if (p.canBoost && p.tank >= T.tank.boost) this.boost();
      else if (!p.lift && p.tank >= T.tank.relift) this.relift();
    }
    p.buffer = Math.max(0, p.buffer - dt);
    p.coyote = Math.max(0, p.coyote - dt);

    let thrust = 0;
    let rising = false;          // a lift burn or a held Space is pushing up
    const jets = [0, 0];
    p.sputter = false;
    const prevY = p.y;
    if (!p.grounded) {
      // Pitch. While an arrow is held, keep queuing another turn ahead so
      // the car flips continuously.
      const spin = this.input.spin;
      if (spin && Math.abs(p.targetAngle - p.angle) < Math.PI) {
        p.targetAngle += spin * TAU;
        this.ensureAirtime(false);
      }
      // Far from the target, spin at full rate; close to it (and not
      // holding), a springy settle that overshoots and wobbles.
      const err = p.targetAngle - p.angle;
      if (spin || Math.abs(err) > 0.8) {
        const want = clamp(err * T.flipGain, -T.flipRate, T.flipRate);
        p.angVel += (want - p.angVel) * Math.min(1, dt * T.flipResponse);
      } else {
        p.angVel += (err * T.settleSpring - p.angVel * T.settleDamp) * dt;
      }
      p.angle += p.angVel * dt;
      // Backflip: the front jet lifts the nose. Front flip: the rear jet.
      if (Math.abs(err) > 0.4) jets[err < 0 ? 1 : 0] = 0.55;
      this.countFlips();

      // The nozzles gimbal to push straight down whatever the car's pitch,
      // so holding Space keeps you up through a flip.
      const climbCap = T.maxClimb * k;
      // Falling, a held Space bites at once; otherwise a short delay tells a
      // hold from a tap.
      const holding = this.input.held && (this.input.heldFor > T.holdDelay || p.vy > 0) && p.tank > 0;
      // A tap's lift burn, swelling and fading.
      let lift = 0;
      let liftJets = 0;
      if (p.lift) {
        p.lift.t += dt;
        const u = p.lift.t / p.lift.dur;
        if (u >= 1) {
          p.lift = null;
        } else {
          const swell = Math.sin(Math.PI * u);
          lift = p.lift.accel * swell;
          liftJets = 0.5 + 0.5 * swell;
        }
      }
      rising = lift > 0 || holding;
      let a = g;
      if (holding) {
        // Keep a jump's momentum longer, then hold a steady climb.
        a = p.vy < -climbCap ? g * 0.55 : g - T.thrust * k * k;
        p.tank = Math.max(0, p.tank - T.tank.hold * dt);
        thrust = 1;
      } else if (this.input.down) {
        a = g + T.dive * k * k;
      } else if (Math.abs(err) > 0.35) {
        // Flip assist: the gimballed nozzles hold the car up mid-spin.
        a = g * T.flipAssist;
        thrust = 0.45;
      } else if (p.vy > 0 && !p.lift && Math.abs(wrapAngle(p.angle)) < 0.6) {
        // Automatic landing burn: brake just enough to keep under a safe
        // descent speed that tapers as the road nears.
        const height = Math.max(0, p.support - p.y);
        const safe = (T.touchdownSpeed + height * T.flareSlope) * k;
        if (p.vy > safe) {
          const brake = Math.min(T.flareBrake, (p.vy - safe) * T.flareGain) * k * k;
          a = g - brake;
          thrust = clamp(brake / (T.flareBrake * k * k), 0.25, 0.8);
        }
      }
      a -= lift;
      thrust = Math.max(thrust, liftJets);
      if (this.input.held && p.tank <= 0) p.sputter = true;
      const wasFast = p.vy < -climbCap;
      p.vy += a * dt;
      if (holding && !wasFast) p.vy = Math.max(p.vy, -climbCap);
      p.y += p.vy * dt;
      if (p.y - ROADSTER.h < T.ceiling) {
        p.y = T.ceiling + ROADSTER.h;
        p.vy = Math.max(0, p.vy);
      }
    } else {
      p.tank = Math.min(1, p.tank + T.tank.refill * dt);
    }

    const support = this.findSupport(prevY);
    p.support = support.y;
    if (p.y >= support.y) {
      if (!p.grounded && !this.land(support.vehicle)) {
        this.crash({x: PLAYER_X + 36, y: support.y - 4});
        return;
      }
      p.y = support.y;
      p.vy = 0;
      p.grounded = true;
      p.on = support.vehicle;
    } else if (p.grounded && support.y - p.y <= 3) {
      // Follow small dips, like rolling from a roof onto a bonnet.
      p.y = support.y;
      p.on = support.vehicle;
    } else if (p.grounded) {
      // Rolled off the end of a vehicle.
      p.grounded = false;
      p.on = null;
      p.coyote = 0.09;
      p.canBoost = true;
    }

    const hit = this.checkCrash() || this.checkStructures();
    if (hit) {
      this.crash(hit);
      return;
    }

    // Visual state: wheels, suspension, pitch, thruster level.
    p.wheelSpin = p.grounded ? this.speed / 6 : p.wheelSpin * Math.exp(-0.5 * dt);
    p.wheelAngle += p.wheelSpin * dt;
    const springAcc = -900 * p.bodyOff - 20 * p.bodyVel;
    p.bodyVel += springAcc * dt;
    p.bodyOff = clamp(p.bodyOff + p.bodyVel * dt, -2, 3);
    // Pitch. Lifting at speed, the rear thruster bites a beat before the
    // front: the tail rises first and the car tips nose-down, then the
    // front catches up and it settles into a gentle nose-down climb.
    // Coasting, it follows its fall a little.
    p.risingFor = rising ? (p.risingFor || 0) + dt : 0;
    let tiltTarget = 0;
    if (!p.grounded && rising) {
      const r = p.risingFor;
      const shape = r < 0.06 ? r / 0.06 : Math.max(0.3, 1 - (r - 0.06) * 1.6);
      tiltTarget = T.liftPitch * shape;
    } else if (!p.grounded) {
      tiltTarget = clamp(p.vy * 0.00008, -0.03, 0.04);
    }
    p.tilt += (tiltTarget - p.tilt) * Math.min(1, dt * 22);
    p.wobbleVel += (-p.wobble * 220 - p.wobbleVel * 11) * dt;
    p.wobble += p.wobbleVel * dt;
    if (!p.grounded) p.wobble *= Math.exp(-12 * dt);
    const rate = thrust > p.thrust ? 30 : 9;
    p.thrust += (thrust - p.thrust) * Math.min(1, dt * rate);
    // The front jet comes up to full a moment after the rear.
    const frontLag = rising ? clamp(p.risingFor / 0.09, 0.25, 1) : 1;
    for (let i = 0; i < 2; i++) {
      const target = Math.max(i === 1 ? thrust * frontLag : thrust, jets[i]);
      p.jets[i] += (target - p.jets[i]) * Math.min(1, dt * (target > p.jets[i] ? 30 : 9));
      if (target > 0) this.emitJet(i, target * (0.85 + 0.15 * k), dt);
    }
    if (p.sputter && Math.random() < dt * 14) {
      for (let i = 0; i < 2; i++) this.spawnGas(i, 0.35, 0.6);
    }
  }

  /**
   * Highest surface the car can rest on: the road, or a vehicle roof the car
   * was above on the previous step. Rolling along, it can also climb ledges
   * up to STEP high; landing from the air only forgives a few pixels.
   */
  findSupport(prevY) {
    const bottom = this.sprites.roadsterBottom;
    const grounded = this.player.grounded;
    const reach = grounded ? STEP : 3;
    // From the air, land on the wheels, not on the overhangs.
    const from = grounded ? 0 : ROADSTER.wheels[0].x - 4;
    const to = grounded ? ROADSTER.w : ROADSTER.wheels[1].x + 4;
    let best = GROUND_Y;
    let vehicle = null;
    for (let c = from; c < to; c += 2) {
      if (!bottom[c]) continue;
      const gap = ROADSTER.h - bottom[c];
      const sx = PLAYER_X + c;
      for (const v of this.vehicles) {
        const s = this.surfaceAt(v, sx);
        if (s === null) continue;
        if (prevY - gap <= s + reach && s + gap < best) {
          best = s + gap;
          vehicle = v;
        }
      }
    }
    return {y: best, vehicle};
  }

  /** A vehicle body more than a step above the car's underside is a crash. */
  checkCrash() {
    const bottom = this.sprites.roadsterBottom;
    const p = this.player;
    for (let c = 0; c < ROADSTER.w; c += 2) {
      if (!bottom[c]) continue;
      const under = p.y - (ROADSTER.h - bottom[c]);
      const sx = PLAYER_X + c;
      for (const v of this.vehicles) {
        const s = this.surfaceAt(v, sx);
        if (s !== null && under - s > STEP) return {x: sx, y: Math.max(s, under - ROADSTER.h / 2)};
      }
    }
    return null;
  }

  surfaceAt(v, sx) {
    const lx = Math.floor(sx - v.x);
    if (lx < 0 || lx >= v.w) return null;
    const t = v.top[lx];
    return t >= v.h ? null : GROUND_Y - v.h + t;
  }

  /** Surface directly under a screen column, for shadows. */
  surfaceBelow(sx) {
    let best = GROUND_Y;
    for (const v of this.vehicles) {
      const s = this.surfaceAt(v, sx);
      if (s !== null && s < best && s >= this.player.y - 2) best = s;
    }
    return best;
  }

  jump() {
    const p = this.player;
    const k = this.k;
    // Lift off gently; the burn in updatePlayer does the climbing.
    p.vy = -60 * k;
    p.lift = {t: 0, dur: TUNING.liftTime / k, accel: TUNING.liftAccel * k * k};
    p.grounded = false;
    p.on = null;
    p.canBoost = true;
    p.coyote = 0;
    p.buffer = 0;
    p.angle = 0;
    p.angVel = 0;
    p.targetAngle = 0;
    p.tapTarget = 0;
    p.flips = 0;
    p.tank = Math.max(0, p.tank - TUNING.tank.jump);
    p.bodyVel += 25;
    for (let i = 0; i < 2; i++) {
      for (let n = 0; n < 14; n++) this.spawnGas(i, 1.1, 1.4);
    }
    this.sound.jump();
  }

  /**
   * Left (-1) or Right (1) pressed: queue one full flip, which letting go
   * never undoes. On the road this launches a flip jump. Holding the key
   * keeps adding flips (see updatePlayer).
   */
  flip(dir) {
    if (this.state !== 'playing' || this.cruise) return;
    this.sound.start();
    const p = this.player;
    const fromRoad = p.grounded || p.coyote > 0;
    if (fromRoad) {
      this.jump();
      // Flips launch with a straight kick; the spin assist does the rest.
      p.lift = null;
      p.vy = -TUNING.flipLaunch * this.k;
    }
    p.targetAngle += dir * TAU;
    p.tapTarget = p.targetAngle;
    this.ensureAirtime(fromRoad);
  }

  /**
   * Arrow released: stop at the nearest upright, but never short of the
   * flips already tapped in.
   */
  releaseSpin() {
    const dir = this.input.spin;
    this.input.spin = 0;
    const p = this.player;
    if (p.grounded) return;
    const nearest = Math.round(p.angle / TAU) * TAU;
    p.targetAngle = dir < 0 ? Math.min(nearest, p.tapTarget) : Math.max(nearest, p.tapTarget);
  }

  /**
   * If the car would land before every queued turn is done, kick it up just
   * enough (in the air this costs N2; with an empty tank, no kick).
   */
  ensureAirtime(fromRoad) {
    const p = this.player;
    const T = TUNING;
    const k = this.k;
    // Airtime needed to finish spinning, with the flip assist holding
    // most of the weight, and the climb speed that buys it from here.
    const t = Math.abs(p.targetAngle - p.angle) / T.flipRate + 0.25;
    const gSpin = T.gravity * k * k * T.flipAssist;
    const height = Math.max(0, p.support - p.y);
    const need = clamp(-(0.5 * gSpin * t * t - height) / t, -650, 0);
    if (p.vy <= need) return;
    if (fromRoad) {
      p.vy = need;
    } else if (p.tank >= T.tank.flip) {
      p.vy = need;
      p.tank -= T.tank.flip;
      for (let i = 0; i < 2; i++) {
        for (let n = 0; n < 24; n++) this.spawnGas(i, 1.1, 1.4);
      }
      this.sound.boost();
    }
  }

  // -------------------------------------------------------------------------
  // Boost autopilot

  startCruise() {
    const p = this.player;
    this.cruise = {phase: 'rise', t: 0, startScore: this.score};
    this.boostReady = false;
    this.banner = null;
    if (this.trick && this.trick.phase === 'air') this.trick = null;
    p.grounded = false;
    p.on = null;
    p.vy = Math.min(p.vy, -320);
    p.angle = p.targetAngle = p.tapTarget = p.angVel = 0;
    p.lift = null;
    p.flips = 0;
    this.input.spin = 0;
    for (let n = 0; n < 70; n++) {
      this.spawnGas(n % 2, 1.4, 1.6);
      this.spawnRearGas(1.3);
    }
    this.shake = 2.5;
    this.sound.superBoost();
    this.announce('Boosting.');
  }

  /** True when no vehicle is under the car or will be for a few seconds. */
  roadClearForLanding() {
    const rel = this.speed * TUNING.trafficRel;
    const clear = (o, ahead) => o.x + o.w < PLAYER_X - 6 || o.x > PLAYER_X + 73 + ahead;
    return this.vehicles.every((v) => clear(v, rel * 2.2)) &&
        this.structures.every((g) => clear(g, this.speed * 2.2));
  }

  /**
   * The boost, flown by itself: rise above traffic, glide at boosted speed
   * (scoring double) until boostPoints are earned, ease back to normal
   * speed, wait for a clear road, then settle onto it.
   */
  updateCruise(dt) {
    const c = this.cruise;
    const p = this.player;
    const T = TUNING;
    c.t += dt;
    if (c.phase === 'rise' && c.t > 0.6) c.phase = 'cruise';
    if (c.phase === 'cruise' && this.score - c.startScore >= T.boostPoints) {
      c.phase = 'slow';
      c.t = 0;
    }
    // Start down while still braking, as soon as the road below is clear.
    if (c.phase === 'slow' && this.boostFactor < 1.35 && this.roadClearForLanding()) {
      c.phase = 'descend';
      c.t = 0;
    }

    // Speed: surge up to the boost, and brake back down to whatever the
    // normal speed has grown to meanwhile.
    const boosting = c.phase === 'rise' || c.phase === 'cruise';
    const target = boosting ? Math.max(1, Math.min(T.boostMultiplier, T.boostSpeedMax / this.baseSpeed)) : 1;
    const rate = target > this.boostFactor ? 2.6 : 2.4;
    this.boostFactor += (target - this.boostFactor) * Math.min(1, dt * rate);
    if (!boosting && this.boostFactor < 1.005) this.boostFactor = 1;
    // Extra points while boosting.
    if (boosting) this.bonus += this.speed * dt / 40 * (T.boostScoreRate - 1);

    // Height: a smooth spring to cruising height with a gentle hover bob,
    // then down to the road.
    const cruiseY = Math.max(T.ceiling + ROADSTER.h + 10, GROUND_Y - T.boostAltitude);
    const targetY = c.phase === 'descend' ? GROUND_Y : cruiseY + Math.sin(this.clock * 2.6) * 2.5;
    const stiff = c.phase === 'descend' ? 20 : 18;
    p.vy += ((targetY - p.y) * stiff - p.vy * 2 * Math.sqrt(stiff)) * dt;
    p.y = Math.min(GROUND_Y, p.y + p.vy * dt);
    p.support = GROUND_Y;

    // Surge toward the middle of the screen while boosting, as if outrunning
    // the camera; ease back home while slowing and landing.
    const surge = boosting ? VIEW_W / 2 - 36 - PLAYER_X : 0;
    // Out gently, home a bit quicker so it is back before touchdown.
    const pull = boosting ? 5 : 11;
    p.xVel += ((surge - p.xOff) * pull - p.xVel * 2 * Math.sqrt(pull)) * dt;
    p.xOff += p.xVel * dt;
    // Wheels retract just after lift-off (flight mode) and drop back down
    // as the car starts its descent.
    const gearUp = (c.phase === 'rise' && c.t > 0.15) || c.phase === 'cruise' || c.phase === 'slow';
    p.gear = clamp(p.gear + (gearUp ? 1 : -1) * dt / 0.45, 0, 1);

    // Pitch: nose up while climbing and braking, level in the glide.
    // Tail lifts first on the way up (like a held lift), level in the
    // glide, nose a touch up while braking.
    const riseTilt = c.t < 0.25 ? T.liftPitch * 0.8 : T.liftPitch * 0.25;
    const tiltTarget = c.phase === 'rise' ? riseTilt : c.phase === 'slow' ? -0.03 : clamp(p.vy * 0.0002, -0.03, 0.03);
    p.tilt += (tiltTarget - p.tilt) * Math.min(1, dt * 4);
    p.wheelSpin *= Math.exp(-0.8 * dt);
    p.wheelAngle += p.wheelSpin * dt;
    p.bodyVel += (-900 * p.bodyOff - 20 * p.bodyVel) * dt;
    p.bodyOff = clamp(p.bodyOff + p.bodyVel * dt, -2, 3);
    p.tank = Math.min(1, p.tank + T.tank.refill * dt);

    // Thrusters: tail jet pushes, bottom jets hold the car up.
    const lift = c.phase === 'rise' ? 1 : c.phase === 'descend' ? 0.55 : 0.5;
    const push = c.phase === 'rise' ? 1 : c.phase === 'cruise' ? 0.85 : 0.15;
    for (let i = 0; i < 2; i++) {
      p.jets[i] += (lift - p.jets[i]) * Math.min(1, dt * 12);
      this.emitJet(i, p.jets[i] * 0.8, dt);
    }
    p.rearJet += (push - p.rearJet) * Math.min(1, dt * 8);
    this.emitRear(p.rearJet, dt);
    p.thrust = Math.max(lift, push);

    if (c.phase === 'descend' && p.y >= GROUND_Y - 0.75 && Math.abs(p.xOff) < 1.5) {
      // Touchdown: back to normal driving with a clear stretch ahead.
      p.y = GROUND_Y;
      p.vy = 0;
      p.grounded = true;
      p.tilt = 0;
      p.xOff = 0;
      p.xVel = 0;
      p.gear = 0;
      p.rearJet = 0;
      p.thrust = 0;
      p.wheelSpin = this.speed / 6;
      p.bodyVel += 40;
      this.cruise = null;
      this.boostFactor = 1;
      this.boostChargeFrom = this.score;
      this.boostReadyAt = this.score + T.boostUnlock;
      this.spawnIn = this.speed * T.trafficRel * 1.2 + 200;
      this.sound.land(0.25);
    }
  }

  emitRear(level, dt) {
    this.rearCarry = (this.rearCarry || 0) + TUNING.gasRate * 1.1 * level * dt;
    while (this.rearCarry >= 1) {
      this.rearCarry -= 1;
      this.spawnRearGas(level);
    }
  }

  /** One puff from the tail thruster, blasting backward. */
  spawnRearGas(power) {
    const at = this.carPoint(REAR_NOZZLE.x - rand(0, 2), REAR_NOZZLE.y + rand(-1.5, 1.5));
    const sp = rand(380, 600) * (0.6 + 0.4 * Math.min(power, 1.4));
    const ang = rand(-0.16, 0.16) - this.player.tilt;
    this.gas.push({
      x: at.x, y: at.y,
      vx: -Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp + this.player.vy * 0.5,
      age: 0, life: rand(0.25, 0.6), size: 1.5, grow: rand(4, 9),
      front: Math.random() < 0.3, tint: 0,
    });
  }

  /**
   * A press in the air once the boost is spent (say, on the way down): the
   * thrusters arrest most of the fall at once, then lift like a tap.
   */
  relift() {
    const p = this.player;
    const k = this.k;
    p.vy = Math.min(p.vy, 0) + Math.max(p.vy, 0) * 0.25;
    p.lift = {t: 0, dur: TUNING.liftTime / k, accel: TUNING.liftAccel * k * k};
    p.buffer = 0;
    p.tank = Math.max(0, p.tank - TUNING.tank.relift);
    for (let i = 0; i < 2; i++) {
      for (let n = 0; n < 16; n++) this.spawnGas(i, 1.1, 1.4);
    }
    this.sound.jump();
  }

  boost() {
    const p = this.player;
    const k = this.k;
    p.vy = Math.min(p.vy, 0) * 0.3;
    p.lift = {t: 0, dur: TUNING.boostLiftTime / k, accel: TUNING.boostLiftAccel * k * k};
    p.canBoost = false;
    p.buffer = 0;
    p.tank = Math.max(0, p.tank - TUNING.tank.boost);
    for (let i = 0; i < 2; i++) {
      for (let n = 0; n < 60; n++) this.spawnGas(i, 1.5, 1.9);
    }
    this.sound.boost();
  }

  /** Called as the wheels touch down. Returns false when the landing is a crash. */
  land(vehicle) {
    const p = this.player;
    // Touching down on the roof or nose is a crash.
    if (Math.abs(wrapAngle(p.angle)) > TUNING.landTolerance) return false;
    const flips = Math.round(p.angle / TAU);
    p.lift = null;
    // A crooked touchdown rocks back onto all four wheels.
    p.wobble = clamp(wrapAngle(p.angle), -0.45, 0.45);
    p.wobbleVel = clamp(p.angVel * 0.25, -3, 3);
    p.angle = 0;
    p.angVel = 0;
    p.targetAngle = 0;
    p.tapTarget = 0;
    p.flips = 0;
    if (flips !== 0 && this.trick && this.trick.phase === 'air') {
      this.trick.phase = 'bank';
      this.trick.age = 0;
      this.sound.trickLanded();
    }
    const impact = clamp(p.vy / 700, 0, 1);
    p.bodyVel += p.vy * 0.035;
    p.canBoost = false;
    this.sound.land(impact);
    if (impact > 0.1) {
      // Vapour pushed out sideways by the touchdown.
      for (let i = 0; i < 18 * impact + 6; i++) {
        const side = Math.random() < 0.5 ? -1 : 1;
        this.gas.push({
          x: PLAYER_X + rand(6, 66), y: p.y - 1, vx: side * rand(40, 180), vy: -rand(5, 50),
          age: 0, life: rand(0.25, 0.5), size: 2, grow: rand(4, 7), front: Math.random() < 0.5,
          tint: 4,
        });
      }
    }
    if (vehicle && vehicle !== p.lastRoof) {
      p.lastRoof = vehicle;
      this.bonus += 10;
      this.texts.push({str: '+10 ROOF', x: PLAYER_X + 36, y: p.y - ROADSTER.h - 6, age: 0, color: '#7fe3ff'});
      this.sound.roof();
    }
    return true;
  }

  /**
   * Shows the trick as soon as a flip is all but complete (within the landing
   * tolerance). Points only bank once the car lands upright.
   */
  countFlips() {
    const p = this.player;
    const sign = p.angle < 0 ? -1 : 1;
    const done = sign * Math.floor((Math.abs(p.angle) + TUNING.landTolerance) / TAU);
    if (done === p.flips) return;
    p.flips = done;
    if (done === 0) {
      if (this.trick && this.trick.phase === 'air') this.trick = null;
      return;
    }
    const award = flipAward(done < 0 ? 'back' : 'front', Math.abs(done));
    this.trick = {...award, kind: done < 0 ? 'back' : 'front', phase: 'air', age: 0};
    this.sound.trick(Math.abs(done));
  }

  updateTrick(dt) {
    const t = this.trick;
    if (!t) return;
    t.age += dt;
    if (t.phase === 'bank' && t.age >= TRICK_GLIDE_END) {
      this.bonus += t.points;
      this.scoreFlash = 0.45;
      this.sound.bank();
      this.trick = null;
    } else if (t.phase === 'fail' && t.age > 1.4) {
      this.trick = null;
    }
  }

  crash(hit) {
    const p = this.player;
    this.state = 'crashed';
    this.crashTime = 0;
    this.slowMo = 0.35;
    this.shake = 7;
    this.sound.crash();
    for (let i = 0; i < 46; i++) {
      const a = rand(-Math.PI, 0);
      const sp = rand(80, 340);
      this.sparks.push({
        x: hit.x, y: hit.y, vx: Math.cos(a) * sp - 60, vy: Math.sin(a) * sp,
        age: 0, life: rand(0.4, 1.1),
        color: Math.random() < 0.5 ? '#ffd27a' : Math.random() < 0.5 ? '#ff8a3a' : '#ffffff',
      });
    }
    // The nitrogen tank vents.
    for (let i = 0; i < 2; i++) {
      for (let n = 0; n < 70; n++) this.spawnGas(i, rand(0.4, 1.4), 4);
    }
    p.vy = Math.min(p.vy, 0) - 140;
    p.grounded = false;
    if (this.trick && this.trick.phase === 'air') {
      this.trick = {label: 'WIPEOUT', points: 0, kind: 'fail', phase: 'fail', age: 0};
    }
    this.announce('Crashed.');
  }

  updateWreck(dt) {
    const p = this.player;
    if (!p.grounded) {
      p.vy += TUNING.gravity * dt;
      p.y += p.vy * dt;
      const floor = this.surfaceBelow(PLAYER_X + 36);
      if (p.y >= floor) {
        p.y = floor;
        p.vy = 0;
        p.grounded = true;
        p.bodyVel += 60;
      }
    }
    p.tilt += (-0.05 - p.tilt) * Math.min(1, dt * 6);
    p.angle += p.angVel * dt;
    p.angVel *= Math.exp(-3 * dt);
    p.thrust *= Math.exp(-3 * dt);
    p.jets[0] *= Math.exp(-3 * dt);
    p.jets[1] *= Math.exp(-3 * dt);
    p.bodyVel += (-900 * p.bodyOff - 14 * p.bodyVel) * dt;
    p.bodyOff = clamp(p.bodyOff + p.bodyVel * dt, -2, 3);
    p.wheelAngle += p.wheelSpin * dt;
    p.wheelSpin *= Math.exp(-2 * dt);
    if (this.crashTime < 1.4 && Math.random() < dt * 30) {
      this.spawnGas(Math.random() < 0.5 ? 0 : 1, rand(0.3, 0.8), 3);
    }
  }

  gameOver() {
    this.state = 'over';
    this.overTime = 0;
    if (this.score > this.hiScore) {
      this.hiScore = this.score;
      this.newBest = true;
      saveHighScore(this.hiScore);
    }
    if (this.button) this.button.hidden = false;
    if (this.shareButton) this.shareButton.hidden = false;
    this.positionButton();
    this.announce(`Game over. Your score is ${this.score}.` +
        (this.newBest ? ' New high score!' : ` Your highest score is ${this.hiScore}.`));
  }

  parseChallenge() {
    try {
      const params = new URLSearchParams(window.location.search);
      const val = parseInt(params.get('challenge'), 10);
      return val > 0 ? val : 0;
    } catch (e) {
      return 0;
    }
  }

  async shareScore() {
    const score = this.score;
    const base = window.location.origin + window.location.pathname;
    const url = base + '?challenge=' + score;
    const text = 'I scored ' + score + ' in Roadster! Can you beat me? ' + url;
    let shared = false;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Roadster',
          text: 'I scored ' + score + ' in Roadster! Can you beat me?',
          url: url,
        });
        shared = true;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    if (!shared) {
      let copied = false;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          copied = true;
        } catch (e) {}
      }
      if (!copied) {
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          copied = true;
        } catch (e) {}
      }
      this.shareCopied = 2.5;
      this.sound.score();
      this.announce('Link copied to clipboard');
    }
  }

  updateScore() {
    this.score = Math.floor(this.distance / 40 + this.bonus);
    if (this.score >= this.nextMilestone) {
      this.nextMilestone += 100;
      this.scoreFlash = 0.9;
      this.sound.score();
    }
    if (this.baseMph >= this.nextMph) {
      if (!this.cruise) this.banner = {str: `${this.nextMph} MPH`, age: 0};
      this.nextMph += 25;
    }
    if (!this.boostReady && !this.cruise && this.score >= this.boostReadyAt) {
      this.boostReady = true;
      this.sound.boostReady();
      this.announce('Boost ready. Double tap space to boost.');
    }
  }

  // -------------------------------------------------------------------------
  // Traffic

  updateVehicles(dt) {
    // Everything stops dead at the moment of a crash.
    if (this.state !== 'playing') return;
    const rel = this.speed * TUNING.trafficRel;
    const own = this.speed * (1 - TUNING.trafficRel);
    for (const v of this.vehicles) {
      v.x -= rel * dt;
      v.wheelAngle += own * dt / 6;
    }
    this.vehicles = this.vehicles.filter((v) => v.x + v.w > -30);
    for (const g of this.structures) g.x -= this.speed * dt;
    this.structures = this.structures.filter((g) => g.x + g.w > -30);
  }

  spawn(dt) {
    // While a boost winds down and lands, keep the road ahead empty.
    if (this.cruise && (this.cruise.phase === 'slow' || this.cruise.phase === 'descend')) return;
    this.spawnIn -= this.speed * TUNING.trafficRel * dt;
    if (this.spawnIn > 0) return;
    const s = this.score;
    const bigBias = 1 + s / 900;
    const options = [
      ['sedan', 3],
      ['crossover', 2],
      ['pair', s > 150 ? 1.4 : 0],
      ['cybertruck', s > 70 ? 1.5 * bigBias : 0],
      ['bus', s > 220 ? 1.0 * bigBias : 0],
      ['semi', s > 320 ? 1.0 * bigBias : 0],
      ['gantry', this.gantryWeight(s)],
    ];
    const total = options.reduce((sum, o) => sum + o[1], 0);
    let roll = Math.random() * total;
    let pick = options[0][0];
    for (const [name, weight] of options) {
      roll -= weight;
      if (roll <= 0) { pick = name; break; }
    }

    const rel = this.speed * TUNING.trafficRel;
    if (pick === 'gantry') {
      // A gantry is fixed to the road, so it closes on the car ahead of it
      // (traffic drives forward a little); start it further back to keep a
      // clear landing spot between them.
      const g = this.addGantry(VIEW_W + 6 + VIEW_W * 0.2 + 60);
      this.spawnIn = g.x + g.w - VIEW_W + rel * rand(0.9, 1.3) + 200;
      return;
    }

    let last;
    const small = () => (Math.random() < 0.6 ? 'sedan' : 'crossover');
    if (pick === 'pair') {
      const a = this.addVehicle(small(), VIEW_W + 6);
      last = this.addVehicle(small(), a.x + a.w + rand(14, 30));
    } else {
      last = this.addVehicle(pick, VIEW_W + 6);
    }
    let gap = rel * rand(0.7, 1.25) + 150;
    if (last.big) gap += rel * 0.35 + 50;
    this.spawnIn = last.x + last.w - VIEW_W + gap;
  }

  /**
   * How often sign gantries come up: none at first, most often while you're
   * learning them, then normal, then rarer once you're well into a run.
   */
  gantryWeight(score) {
    const T = TUNING;
    if (score < T.gantryFrom) return 0;
    if (score < T.gantryPeakUntil) return 3.2;
    if (score < T.gantryRareFrom) return 1.4;
    return 0.35;
  }

  addGantry(x) {
    const signs = this.sprites.gantries;
    const art = signs[Math.floor(Math.random() * signs.length)];
    const span = GANTRY.skew * (GANTRY.nearLeg - GANTRY.farLeg);
    const g = {x, w: Math.ceil(span) + 4, art};
    this.structures.push(g);
    return g;
  }

  /**
   * Screen point of a gantry part at road depth z (0 far curb, 1 near edge)
   * and height h above the road there.
   */
  gantryPoint(g, z, h) {
    return [
      g.x + (z - GANTRY.farLeg) * GANTRY.skew,
      ROAD_FAR + z * (ROAD_NEAR - ROAD_FAR) - h,
    ];
  }

  /** Depth of our lane, where the wheels run. */
  laneDepth() {
    return (GROUND_Y - ROAD_FAR) / (ROAD_NEAR - ROAD_FAR);
  }

  /**
   * Only the slice of board and beam directly over our lane can be hit: a
   * thin wall from the board's bottom edge up to the top of the beam.
   */
  checkStructures() {
    const p = this.player;
    // A little inside the car's outline, so a pixel-close miss counts.
    const cx0 = PLAYER_X + 6;
    const cx1 = PLAYER_X + 67;
    const cy0 = p.y - 16;
    const cy1 = p.y - 1;
    const sy1 = GROUND_Y - GANTRY.clearance;
    const sy0 = GROUND_Y - GANTRY.postHeight;
    const z = this.laneDepth();
    for (const g of this.structures) {
      const [sx] = this.gantryPoint(g, z, 0);
      if (cx1 > sx - 2 && cx0 < sx + 3 && cy1 > sy0 && cy0 < sy1) {
        return {x: sx, y: clamp((cy0 + cy1) / 2, sy0, sy1)};
      }
    }
    return null;
  }

  addVehicle(name, x) {
    const spec = VEHICLE_SPECS[name];
    const variants = this.sprites.vehicles[name];
    const art = variants[Math.floor(Math.random() * variants.length)];
    const v = {
      name, spec, art: art.canvas, top: art.top, x, w: spec.w, h: spec.h,
      big: spec.big, wheelAngle: rand(0, 6),
    };
    this.vehicles.push(v);
    return v;
  }

  // -------------------------------------------------------------------------
  // Particles

  /** Continuous stream from nozzle i (0 rear, 1 front). */
  emitJet(i, level, dt) {
    this.gasCarry[i] += TUNING.gasRate * level * dt;
    while (this.gasCarry[i] >= 1) {
      this.gasCarry[i] -= 1;
      this.spawnGas(i, level, 1);
    }
  }

  /**
   * Sprite point the car turns about. Tipped nose-down outside a flip (the
   * lift-off pitch) it turns about the front tyre's contact patch, so the
   * tail visibly rises first; otherwise about its middle.
   */
  pivot() {
    const p = this.player;
    if (!p.grounded && p.tilt > 0 && Math.abs(p.angle) < 0.01) {
      return {x: ROADSTER.wheels[1].x, y: ROADSTER.h};
    }
    return PIVOT;
  }

  /** Screen position of a point on the car sprite, after pitch and flips. */
  carPoint(sx, sy) {
    const p = this.player;
    const a = p.angle + p.tilt;
    const pv = this.pivot();
    const dx = sx - pv.x;
    const dy = sy - pv.y;
    return {
      x: this.carX + pv.x + dx * Math.cos(a) - dy * Math.sin(a),
      y: Math.round(p.y - ROADSTER.h) + pv.y + p.bodyOff + dx * Math.sin(a) + dy * Math.cos(a),
    };
  }

  /** One puff of nitrogen from nozzle i (0 rear, 1 front). */
  spawnGas(i, power, spread) {
    const n = ROADSTER.nozzles[i];
    const p = this.player;
    const sp = rand(300, 520) * (0.55 + 0.45 * Math.min(power, 1.5));
    // Each jet leans outward a little, like the reveal footage. The nozzles
    // ride round with the car but gimbal to fire downward.
    const ang = n.dir * 0.3 + rand(-0.22, 0.22) * spread;
    const at = this.carPoint(n.x + rand(-1.5, 1.5), n.y);
    this.gas.push({
      x: at.x,
      y: at.y,
      vx: Math.sin(ang) * sp,
      vy: Math.cos(ang) * sp + p.vy,
      age: 0,
      life: rand(0.3, 0.75),
      size: 1.5,
      grow: rand(6, 12),
      front: Math.random() < 0.3,
      tint: 0,
    });
    if (this.gas.length > 3600) this.gas.splice(0, this.gas.length - 3600);
  }

  /** Soft steam from the odd rooftop vent, drifting with the wind. */
  updateSteam(dt) {
    for (const layer of [this.towers, this.nearCity]) {
      const w = layer.canvas.width;
      const off = (this.distance * layer.factor) % w;
      for (let x0 = -off - w; x0 < VIEW_W + 20; x0 += w) {
        for (const v of layer.vents) {
          const sx = x0 + v.x;
          // Each vent puffs for a few seconds, then goes quiet for a while.
          if (Math.sin(this.clock * 0.35 + v.phase) < 0.75) continue;
          if (sx < -20 || sx > VIEW_W + 20 || Math.random() > dt * 2) continue;
          this.steam.push({
            x: sx, y: layer.y + v.y, vx: -rand(2, 6), vy: -rand(6, 12),
            age: 0, life: rand(2.5, 4.5), grow: rand(5, 9), factor: layer.factor,
          });
        }
      }
    }
    for (const p of this.steam) {
      p.age += dt;
      p.x += (p.vx - this.speed * p.factor) * dt;
      p.y += p.vy * dt;
      p.vy *= Math.exp(-0.3 * dt);
    }
    this.steam = this.steam.filter((p) => p.age < p.life && p.x > -30);
  }

  updateParticles(dt) {
    this.updateSteam(dt);
    const air = -this.speed;
    const drag = 1 - Math.exp(-4.2 * dt);
    for (const g of this.gas) {
      g.age += dt;
      // Gas slows to the still air (which streams past at road speed) and
      // drifts up a touch once it has lost its push.
      g.vx += (air - g.vx) * drag + (Math.random() - 0.5) * 120 * dt;
      g.vy += (-10 - g.vy) * drag * 0.85 + (Math.random() - 0.5) * 60 * dt;
      const prevY = g.y;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      // The road, or the roof of a vehicle the puff was above.
      let floor = GROUND_Y;
      for (const v of this.vehicles) {
        const s = this.surfaceAt(v, g.x);
        if (s !== null && prevY <= s + 1 && s < floor) floor = s;
      }
      if (g.y > floor - 1) {
        // Hitting a surface spreads the jet sideways into a short-lived
        // cloud that clears quickly instead of pooling on the road.
        g.y = floor - 1;
        if (g.vy > 40) {
          g.vx += (Math.random() < 0.5 ? -1 : 1) * g.vy * rand(0.4, 1.2);
          g.grow += 2.5;
          g.life = Math.min(g.life, g.age + rand(0.15, 0.3));
        }
        g.vy = -Math.abs(g.vy) * 0.1;
      }
    }
    this.gas = this.gas.filter((g) => g.age < g.life && g.x > -30);

    for (const s of this.sparks) {
      s.age += dt;
      s.vy += 900 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.y > GROUND_Y) {
        s.y = GROUND_Y;
        s.vy *= -0.35;
        s.vx *= 0.7;
      }
    }
    this.sparks = this.sparks.filter((s) => s.age < s.life);

    const rush = clamp((this.speed - 420) / 700, 0, 1);
    if (this.state === 'playing' && Math.random() < dt * rush * 110) {
      this.streaks.push({
        x: VIEW_W + rand(0, 30), y: rand(30, GROUND_Y - 6), len: rand(10, 42),
        v: this.speed * rand(1.6, 2.6), alpha: rand(0.06, 0.2),
      });
    }
    for (const s of this.streaks) s.x -= s.v * dt;
    this.streaks = this.streaks.filter((s) => s.x + s.len > 0);

    for (const t of this.texts) {
      t.age += dt;
      t.y -= 18 * dt;
    }
    this.texts = this.texts.filter((t) => t.age < 1.2);
  }

  // -------------------------------------------------------------------------
  // Background

  buildBackground() {
    // Night sky in hard bands, darker at the top.
    this.sky = makeCanvas(VIEW_W + 16, GROUND_Y + 8);
    const sp = new Painter(this.sky);
    const bands = ['#050608', '#06070a', '#07080c', '#08090d', '#090b0f', '#0b0d12', '#0d1016', '#10131a'];
    const bandH = Math.ceil(this.sky.height / bands.length);
    bands.forEach((c, i) => sp.rect(0, i * bandH, this.sky.width, bandH, c));

    const rnd = seeded(7);
    this.stars = [];
    for (let i = 0; i < 70; i++) {
      this.stars.push({x: rnd() * VIEW_W, y: rnd() * (GROUND_Y - 80), phase: rnd() * 6.28, rate: 0.5 + rnd() * 2, big: rnd() < 0.12});
    }

    // Three city layers, back to front: a low haze of distant blocks, tall
    // towers with crowns and spires, and the nearer mid-rise city.
    const verge = ROAD_FAR - 6;
    const towerH = clamp(verge - 30, 110, 210);
    this.farCity = this.buildSkyline(1200, 90, {
      color: '#090b0f', edge: '#0c0f14', baked: 0.01, live: 0.006,
      minW: 12, maxW: 40, minH: 0.2, gap: 4, tall: false, vents: 0,
    }, seeded(11));
    this.towers = this.buildSkyline(1500, towerH, {
      color: '#0c0e13', edge: '#12161d', baked: 0.014, live: 0.03,
      minW: 14, maxW: 34, minH: 0.45, gap: 12, tall: true, vents: 0.05,
    }, seeded(31));
    this.nearCity = this.buildSkyline(1300, 104, {
      color: '#0f1218', edge: '#141821', baked: 0.018, live: 0.022,
      minW: 14, maxW: 48, minH: 0.17, gap: 6, tall: false, vents: 0.03,
    }, seeded(23));
    this.farCity.y = verge - 96;
    this.farCity.factor = 0.03;
    this.towers.y = verge - towerH;
    this.towers.factor = 0.06;
    this.nearCity.y = verge - 104;
    this.nearCity.factor = 0.11;
    this.steam = [];

    // Asphalt grain in two depth bands: finer and dimmer far away, coarser
    // close up. Each band scrolls at its own speed.
    const rr = seeded(5);
    this.grainFar = makeCanvas(VIEW_W, GROUND_Y - ROAD_FAR);
    const gf = new Painter(this.grainFar);
    for (let i = 0; i < 90; i++) {
      gf.px(rr() * VIEW_W, 2 + rr() * (GROUND_Y - ROAD_FAR - 3), rr() < 0.5 ? '#14171c' : '#171a20');
    }
    this.grainNear = makeCanvas(VIEW_W, ROAD_NEAR - GROUND_Y);
    const gn = new Painter(this.grainNear);
    for (let i = 0; i < 120; i++) {
      gn.rect(Math.floor(rr() * VIEW_W), Math.floor(rr() * (ROAD_NEAR - GROUND_Y - 1)),
          rr() < 0.4 ? 2 : 1, 1, rr() < 0.5 ? '#191c22' : '#1e2128');
    }
  }

  /**
   * One repeating skyline tile. Buildings get a lit top edge, a grid of
   * windows (some baked in dim, some "live" so they can switch on and off),
   * and on tall layers stepped crowns with spires. Returns where the live
   * windows, aviation lights and rooftop steam vents are.
   */
  buildSkyline(width, height, style, rnd) {
    const c = makeCanvas(width, height);
    const p = new Painter(c);
    const antennas = [];
    const lights = [];
    const vents = [];
    // Headroom above the tallest body for crowns and spires.
    const headroom = style.tall ? 30 : 8;
    let x = 0;
    while (x < width - 10) {
      const w = style.minW + Math.floor(rnd() * (style.maxW - style.minW));
      const h = Math.floor((height - headroom) * (style.minH + rnd() * (1 - style.minH)));
      const top = height - h;
      p.rect(x, top, w, h, style.color);
      p.rect(x, top, w, 1, style.edge);
      if (style.tall && h > (height - headroom) * 0.6 && rnd() < 0.65) {
        // Stepped crown, often with a spire.
        const cw = Math.max(4, Math.floor(w * (0.4 + rnd() * 0.3)));
        const ch = 4 + Math.floor(rnd() * 10);
        const cx = x + Math.floor((w - cw) / 2);
        p.rect(cx, top - ch, cw, ch, style.color);
        p.rect(cx, top - ch, cw, 1, style.edge);
        if (rnd() < 0.7) {
          const sh = 5 + Math.floor(rnd() * (headroom - ch - 6));
          const sx = cx + Math.floor(cw / 2);
          p.rect(sx, top - ch - sh, 1, sh, style.color);
          antennas.push({x: sx, y: top - ch - sh - 1, phase: rnd() * 6});
        }
      } else if (h > (height - headroom) * 0.7 && rnd() < 0.5) {
        p.rect(x + Math.floor(w / 2), top - 6, 1, 6, style.color);
        antennas.push({x: x + Math.floor(w / 2), y: top - 7, phase: rnd() * 6});
      }
      for (let wy = top + 4; wy < height - 3; wy += 4) {
        for (let wx = x + 2; wx < x + w - 2; wx += 3) {
          const r = rnd();
          if (r < style.baked) {
            p.px(wx, wy, rnd() < 0.7 ? '#232a37' : '#3b3224');
          } else if (r < style.baked + style.live) {
            // Most change every half-minute or so; a few flicker quicker.
            const quick = rnd() < 0.15;
            lights.push({x: wx, y: wy, warm: rnd() < 0.35, phase: rnd() * 6.28,
              rate: quick ? 0.6 + rnd() * 1.2 : 0.04 + rnd() * 0.2});
          }
        }
      }
      if (rnd() < style.vents) {
        const vx = x + 2 + Math.floor(rnd() * (w - 4));
        p.rect(vx, top - 3, 2, 3, style.edge);
        vents.push({x: vx + 1, y: top - 3, phase: rnd() * 6.28});
      }
      x += w + Math.floor(rnd() * style.gap);
    }
    return {canvas: c, antennas, lights, vents};
  }

  // -------------------------------------------------------------------------
  // Drawing

  render() {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    // Motion blur, 0..1: starts around 160 mph, full at boost speed.
    this.blur = clamp((this.speed - 450) / 900, 0, 1);
    ctx.save();
    if (this.shake > 0.3) {
      ctx.translate(Math.round(rand(-1, 1) * this.shake), Math.round(rand(-1, 1) * this.shake * 0.6));
    }
    this.drawSky();
    this.drawRoad();
    this.drawShadows();
    this.drawStructures();
    this.drawVehicles();
    this.drawGas(false);
    this.drawPlayer();
    this.drawGas(true);
    this.drawStructurePosts();
    this.drawSparks();
    this.drawStreaks();
    ctx.restore();

    ctx.save();
    ctx.scale(UI_ZOOM, UI_ZOOM);
    this.drawHud();
    if (this.state === 'title') this.drawTitle();
    else if (this.state === 'over') this.drawGameOver();
    else if (this.state === 'paused') this.drawPaused();
    ctx.restore();

    if (this.handheld) {
      const h = this.hudCtx;
      h.clearRect(0, 0, this.hud.width, this.hud.height);
      h.save();
      // Flush with the frame's edges below.
      h.translate(-12, -4);
      this.drawCorners(h, this.hud.width + 24);
      h.restore();
    }
  }

  drawSky() {
    const ctx = this.ctx;
    ctx.drawImage(this.sky, -8, -8);
    const blur = this.blur;
    const streak = Math.round(blur * 8);
    for (const s of this.stars) {
      const tw = 0.5 + 0.5 * Math.sin(this.clock * s.rate + s.phase);
      const x = ((s.x - this.distance * 0.01) % VIEW_W + VIEW_W) % VIEW_W;
      if (streak > 0) {
        ctx.fillStyle = `rgba(210,220,235,${(0.12 + tw * 0.15).toFixed(2)})`;
        ctx.fillRect(Math.round(x) + 1, Math.round(s.y), streak, 1);
      }
      ctx.fillStyle = `rgba(210,220,235,${(0.2 + tw * 0.6).toFixed(2)})`;
      ctx.fillRect(Math.round(x), Math.round(s.y), 1, 1);
      if (s.big && tw > 0.8) {
        ctx.fillStyle = 'rgba(210,220,235,0.25)';
        ctx.fillRect(Math.round(x) - 1, Math.round(s.y), 3, 1);
        ctx.fillRect(Math.round(x), Math.round(s.y) - 1, 1, 3);
      }
    }
    ctx.drawImage(this.sprites.moon, VIEW_W - 92, 48);

    const verge = ROAD_FAR - 6;
    this.drawCity(this.farCity, blur * 4);
    this.drawCity(this.towers, blur * 9);
    this.drawSteam(this.towers.factor);
    this.drawCity(this.nearCity, blur * 16);
    this.drawSteam(this.nearCity.factor);
    this.drawDistantHighway(verge);

    // Street lights between the city and the road. At speed each one
    // leaves fading copies behind it and its lamp smears into a streak.
    const spacing = 230;
    const off = (this.distance * 0.6) % spacing;
    const ghosts = blur > 0.05 ? 4 : 0;
    for (let x = -off; x < VIEW_W + spacing; x += spacing) {
      const px = Math.round(x);
      const lampY = verge - 60;
      this.paint.poly([[px + 9, lampY + 1], [px - 14, ROAD_FAR + 4], [px + 40, ROAD_FAR + 4]], 'rgba(255,222,160,0.035)');
      for (let g = ghosts; g >= 1; g--) {
        const gx = px + Math.round(g * blur * 9);
        ctx.globalAlpha = 0.28 * (1 - g / (ghosts + 1));
        ctx.fillStyle = '#1b1e25';
        ctx.fillRect(gx, lampY, 1, verge - lampY);
        ctx.fillRect(gx, lampY, 9, 1);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#1b1e25';
      ctx.fillRect(px, lampY, 1, verge - lampY);
      ctx.fillRect(px, lampY, 9, 1);
      if (blur > 0.05) {
        ctx.fillStyle = 'rgba(255,230,180,0.2)';
        ctx.fillRect(px + 7, lampY + 1, 3 + Math.round(blur * 30), 1);
      }
      ctx.fillStyle = '#ffe6b3';
      ctx.fillRect(px + 7, lampY + 1, 3, 1);
      ctx.fillStyle = 'rgba(255,230,180,0.25)';
      ctx.fillRect(px + 6, lampY + 2, 5, 1);
    }
  }

  /**
   * A skyline layer; blurPx smears it with faint copies trailing behind.
   * Live windows switch on and off slowly, a few flicker.
   */
  drawCity(layer, blurPx = 0) {
    const ctx = this.ctx;
    const y = layer.y;
    const w = layer.canvas.width;
    const off = (this.distance * layer.factor) % w;
    const ghosts = blurPx >= 1 ? 3 : 0;
    for (let x = -off - w; x < VIEW_W; x += w) {
      for (let g = ghosts; g >= 1; g--) {
        ctx.globalAlpha = 0.3 * (1 - g / (ghosts + 1));
        ctx.drawImage(layer.canvas, Math.round(x + g * blurPx / ghosts), y);
      }
      ctx.globalAlpha = 1;
      ctx.drawImage(layer.canvas, Math.round(x), y);
      for (const warm of [false, true]) {
        ctx.fillStyle = warm ? '#94713f' : '#566c90';
        for (const l of layer.lights) {
          if (l.warm !== warm || Math.sin(this.clock * l.rate + l.phase) < -0.25) continue;
          const lx = Math.round(x + l.x);
          if (lx >= -2 && lx <= VIEW_W + 2) ctx.fillRect(lx, y + l.y, 1, 1);
        }
      }
      for (const a of layer.antennas) {
        if (Math.sin(this.clock * 2.2 + a.phase) > 0.55) {
          ctx.fillStyle = '#ff3030';
          ctx.fillRect(Math.round(x + a.x), y + a.y, 1, 1);
          ctx.fillStyle = 'rgba(255,48,48,0.25)';
          ctx.fillRect(Math.round(x + a.x) - 1, y + a.y - 1, 3, 3);
        }
      }
    }
  }

  /**
   * A road seen from slightly above: the far curb sits higher up the screen,
   * the asphalt lightens toward the viewer, and markings closer to the
   * viewer are thicker and scroll faster than the far ones.
   */
  drawRoad() {
    const ctx = this.ctx;
    const d = this.distance;
    const full = (y, h, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(-8, y, VIEW_W + 16, h);
    };
    // Scrolls a repeating pattern at a depth-dependent speed.
    const repeat = (factor, period, draw) => {
      const off = (d * factor) % period;
      for (let x = -off - period; x < VIEW_W + period; x += period) draw(Math.round(x));
    };

    // Sidewalk and guardrail on the far side.
    // Motion blur stretches everything along the road as speed rises.
    const blur = this.blur;
    const smear = (px) => Math.round(blur * px);

    // Sidewalk and guardrail on the far side.
    const verge = ROAD_FAR - 6;
    full(verge, 6, '#0a0b0e');
    full(verge + 1, 1, '#2c3139');
    full(verge + 2, 1, '#1d2026');
    ctx.fillStyle = '#1d2026';
    repeat(0.9, 22, (x) => ctx.fillRect(x, verge + 2, 1 + smear(10), 4));

    // Asphalt, a shade lighter in each band toward the viewer. The grain
    // gets fading copies trailing behind it at speed.
    full(ROAD_FAR, 8, '#0b0d10');
    full(ROAD_FAR + 8, 10, '#0d0f13');
    full(GROUND_Y, 10, '#0f1115');
    full(GROUND_Y + 10, ROAD_NEAR - GROUND_Y - 10, '#111318');
    for (const [canvas, factor, y, reach] of [[this.grainFar, 0.93, ROAD_FAR, 8], [this.grainNear, 1.1, GROUND_Y, 16]]) {
      if (blur > 0.05) {
        for (let g = 3; g >= 1; g--) {
          ctx.globalAlpha = 0.35 * (1 - g / 4);
          repeat(factor, VIEW_W, (x) => ctx.drawImage(canvas, x + Math.round(g * blur * reach / 3), y));
        }
        ctx.globalAlpha = 1;
      }
      repeat(factor, VIEW_W, (x) => ctx.drawImage(canvas, x, y));
    }

    // Far curb.
    full(ROAD_FAR, 1, '#3a3f48');
    full(ROAD_FAR + 1, 1, '#16181d');

    // Far lane line: thin, short, slower.
    ctx.fillStyle = '#272b33';
    repeat(0.94, 30, (x) => ctx.fillRect(x, ROAD_FAR + 8, 9 + smear(12), 1));

    // Near lane line: thicker and longer, with a slanted leading edge; at
    // speed each dash drags a fainter tail.
    repeat(1.1, 56, (x) => {
      if (blur > 0.05) {
        ctx.fillStyle = 'rgba(61,66,76,0.45)';
        ctx.fillRect(x + 24, GROUND_Y + 13, smear(26), 2);
      }
      ctx.fillStyle = '#3d424c';
      ctx.fillRect(x + 1, GROUND_Y + 13, 24, 1);
      ctx.fillStyle = '#343943';
      ctx.fillRect(x, GROUND_Y + 14, 24, 1);
    });

    // Solid near edge line, then the shoulder.
    full(ROAD_NEAR, 2, '#474d57');
    full(ROAD_NEAR + 2, 1, '#22252b');
    full(ROAD_NEAR + 3, VIEW_H - ROAD_NEAR + 5, '#0a0b0e');

    // Red LED strip along the shoulder, like the reveal runway.
    const ledY = VIEW_H - 6;
    ctx.fillStyle = 'rgba(255,40,40,0.05)';
    ctx.fillRect(-8, ledY - 4, VIEW_W + 16, 9);
    const ledOff = (d * 1.2) % 12;
    // At full blur the lights run together into one streak.
    const ledLen = 5 + smear(7);
    for (let x = -ledOff; x < VIEW_W + 12; x += 12) {
      const lx = Math.round(x);
      ctx.fillStyle = 'rgba(255,46,46,0.22)';
      ctx.fillRect(lx - 1, ledY - 1, ledLen + 2, 3);
      ctx.fillStyle = '#ff2e2e';
      ctx.fillRect(lx, ledY, ledLen, 1);
    }
  }

  drawShadows() {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    for (const v of this.vehicles) {
      ctx.fillRect(Math.round(v.x) + 2, GROUND_Y, v.w - 4, 2);
    }
    const p = this.player;
    const surface = this.surfaceBelow(this.carX + 36);
    const alt = Math.max(0, surface - p.y);
    const w = Math.round(64 * clamp(1 - alt / 240, 0.3, 1));
    const a = 0.55 * clamp(1 - alt / 200, 0.12, 1);
    ctx.fillStyle = `rgba(0,0,0,${a.toFixed(2)})`;
    ctx.fillRect(Math.round(this.carX) + 36 - Math.round(w / 2), surface, w, 2);
  }

  drawSteam(factor) {
    const ctx = this.ctx;
    for (const p of this.steam) {
      if (p.factor !== factor) continue;
      const t = p.age / p.life;
      const size = Math.round(1 + p.grow * Math.sqrt(t));
      const a = 0.09 * (1 - t) * Math.min(1, t * 5);
      ctx.fillStyle = `rgba(200,206,216,${a.toFixed(3)})`;
      ctx.fillRect(Math.round(p.x - size / 2), Math.round(p.y - size / 2), size, size);
    }
  }

  /**
   * A far elevated highway in front of the city: a dark deck on pillars,
   * soft orange sodium lamps, and tiny headlights and tail lights moving
   * along it. Kept dim so it never competes with the road.
   */
  drawDistantHighway(verge) {
    const ctx = this.ctx;
    const d = this.distance;
    const f = 0.3;
    const y = verge - 24;
    ctx.fillStyle = '#0c0f13';
    ctx.fillRect(-8, y, VIEW_W + 16, 3);
    ctx.fillStyle = '#151a22';
    ctx.fillRect(-8, y, VIEW_W + 16, 1);
    ctx.fillStyle = '#0b0d11';
    const pillarOff = (d * f) % 72;
    for (let x = -pillarOff; x < VIEW_W + 72; x += 72) ctx.fillRect(Math.round(x), y + 3, 3, verge - y - 3);
    const lampOff = (d * f) % 36;
    for (let x = -lampOff; x < VIEW_W + 36; x += 36) {
      const lx = Math.round(x);
      ctx.fillStyle = '#14181f';
      ctx.fillRect(lx, y - 5, 1, 5);
      ctx.fillStyle = 'rgba(255,170,90,0.09)';
      ctx.fillRect(lx - 2, y - 7, 6 + Math.round(this.blur * 8), 3);
      ctx.fillRect(lx - 3, y, 8, 2);
      ctx.fillStyle = '#e8a35a';
      ctx.fillRect(lx, y - 6, 2, 1);
    }
    const span = VIEW_W + 60;
    for (let i = 0; i < 7; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      const raw = i * 157 + this.clock * (22 + i * 5) * dir - d * f;
      const x = ((raw % span) + span) % span - 30;
      ctx.fillStyle = dir > 0 ? 'rgba(255,240,210,0.5)' : 'rgba(255,60,60,0.45)';
      ctx.fillRect(Math.round(x), y - 1, 2, 1);
    }
  }

  /**
   * Gantries, in perspective: the far leg, the board's shadow on the road,
   * the truss beam from leg to leg, the board hanging from it (its face
   * sheared to follow the road's depth) and lamps lighting it. The near leg
   * is drawn later, in front of the car.
   */
  drawStructures() {
    const ctx = this.ctx;
    const G = GANTRY;
    const slope = (ROAD_NEAR - ROAD_FAR) / G.skew;
    for (const g of this.structures) {
      const pt = (z, h) => this.gantryPoint(g, z, h);
      this.drawGantryLeg(g, G.farLeg, 2, '#262d2a', '#353e3a');

      // Shadow of the board across the lanes.
      const s1 = pt(G.z1, 0);
      const s2 = pt(G.z2, 0);
      this.paint.poly([[s1[0] + 3, s1[1]], [s2[0] + 3, s2[1]], [s2[0] + 9, s2[1]], [s1[0] + 9, s1[1]]], 'rgba(0,0,0,0.28)');

      // Board, sheared so its top edge runs along the beam.
      const [bx, by] = pt(G.z1, G.postHeight - G.beam);
      ctx.save();
      ctx.transform(1, slope, 0, 1, Math.round(bx), Math.round(by));
      ctx.drawImage(g.art, 0, 0);
      ctx.restore();
      // The board's thickness, a darker edge along its near side.
      const e1 = pt(G.z2, G.postHeight - G.beam);
      const e2 = pt(G.z2, G.clearance);
      ctx.fillStyle = '#123a25';
      ctx.fillRect(Math.round(e1[0]), Math.round(e1[1]), 2, Math.round(e2[1] - e1[1]));

      // A slim truss from the far leg to the near leg: a lit top rail, a
      // darker bottom rail and small ties between them.
      const a = pt(G.farLeg, G.postHeight);
      const b = pt(G.nearLeg, G.postHeight);
      const rail = (off, color) => this.paint.line(a[0], a[1] + off, b[0], b[1] + off, color);
      rail(1, '#3c4742');
      rail(2, '#3c4742');
      rail(0, '#9aa79f');
      rail(G.beam - 1, '#6b7871');
      for (let t = 0.04; t < 1; t += 0.08) {
        const x = Math.round(lerp(a[0], b[0], t));
        const y = Math.round(lerp(a[1], b[1], t));
        this.paint.px(x, y + 1, '#56625c');
        this.paint.px(x, y + 2, '#56625c');
      }

      // Two lamps under the beam wash the top of the board.
      for (const z of [G.z1 + 0.22, G.z2 - 0.22]) {
        const [lx, ly] = pt(z, G.postHeight - G.beam);
        ctx.fillStyle = '#ffe7ad';
        ctx.fillRect(Math.round(lx) - 1, Math.round(ly), 3, 1);
        ctx.fillStyle = 'rgba(255,236,190,0.14)';
        ctx.fillRect(Math.round(lx) - 3, Math.round(ly) + 1, 7, 4);
      }
    }
  }

  /** One leg of a gantry at depth z, from the ground to the beam. */
  drawGantryLeg(g, z, width, color, light) {
    const ctx = this.ctx;
    const [x, top] = this.gantryPoint(g, z, GANTRY.postHeight);
    const [, base] = this.gantryPoint(g, z, 0);
    const lx = Math.round(x) - Math.floor(width / 2);
    ctx.fillStyle = color;
    ctx.fillRect(lx, Math.round(top), width, Math.round(base - top) + 1);
    ctx.fillStyle = light;
    ctx.fillRect(lx, Math.round(top), 1, Math.round(base - top) + 1);
    ctx.fillStyle = '#1c2220';
    ctx.fillRect(lx - 1, Math.round(base) - 1, width + 2, 2);
  }

  /** Near legs, drawn in front of the car since they stand on the near shoulder. */
  drawStructurePosts() {
    for (const g of this.structures) this.drawGantryLeg(g, GANTRY.nearLeg, 3, '#3a4540', '#56635c');
  }

  drawVehicles() {
    const ctx = this.ctx;
    for (const v of this.vehicles) {
      const x = Math.round(v.x);
      const y = GROUND_Y - v.h;
      ctx.drawImage(v.art, x, y);
      const spin = ((v.wheelAngle % (Math.PI * 2 / 5)) + Math.PI * 2 / 5) % (Math.PI * 2 / 5);
      const frame = Math.floor(spin / (Math.PI * 2 / 5) * 6) % 6;
      for (const w of v.spec.wheels) {
        ctx.drawImage(this.sprites.trafficWheels[w.r][frame], Math.round(x + w.x - w.r), Math.round(y + w.y - w.r));
      }
      // Tail light glow.
      for (const [tx, ty, , th] of v.spec.tail) {
        ctx.fillStyle = 'rgba(255,40,40,0.28)';
        ctx.fillRect(x + tx - 3, y + ty - 1, 3, th + 2);
      }
    }
  }

  /** Light pool the headlights throw on the road just ahead. */
  drawHeadlightPool() {
    const p = this.player;
    const alt = GROUND_Y - p.y;
    const upright = Math.cos(p.angle);
    if (alt >= 60 || upright < 0.7) return;
    const a = 0.08 * (1 - alt / 60) * upright;
    const nx = Math.round(this.carX) + 72;
    this.ctx.fillStyle = `rgba(214,236,255,${a.toFixed(3)})`;
    this.ctx.fillRect(nx + 20, GROUND_Y + 1, 120, 2);
    this.ctx.fillRect(nx + 40, GROUND_Y + 3, 80, 2);
  }

  /**
   * The car, its headlight beam and jet cores, turned by pitch and flips.
   * In flight mode (boost) the wheels slide up into the body, shrinking and
   * fading, while the closed-up spaceship hull and its underglow fade in.
   */
  drawPlayer() {
    const ctx = this.ctx;
    const p = this.player;
    const s = this.sprites;
    const x = Math.round(this.carX);
    const top = Math.round(p.y - ROADSTER.h);
    const bodyY = top + Math.round(p.bodyOff);
    const droop = p.grounded ? 0 : 1;
    const sector = Math.PI * 2 / 5;
    const spin = ((p.wheelAngle % sector) + sector) % sector;
    const frame = p.wheelSpin > 105 ? 6 : Math.floor(spin / sector * 6) % 6;

    this.drawHeadlightPool();
    ctx.save();
    if (p.grounded && Math.abs(p.wobble) > 0.012) {
      // Rocking after a crooked landing: pivot on the wheel that is down
      // (front wheel when nose-down, rear when nose-up) so it stays on the road.
      const w = ROADSTER.wheels[p.wobble > 0 ? 1 : 0];
      const cx = x + w.x;
      const cy = top + ROADSTER.h;
      ctx.translate(cx, cy);
      ctx.rotate(p.wobble);
      ctx.translate(-cx, -cy);
    } else {
      const angle = wrapAngle(p.angle + p.tilt + p.wobble);
      if (Math.abs(angle) > 0.012) {
        const pv = this.pivot();
        const cx = x + pv.x;
        const cy = top + pv.y;
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        ctx.translate(-cx, -cy);
      }
    }
    const nx = x + 72;
    const ny = bodyY + 11;
    this.paint.poly([[nx, ny], [nx + 160, ny - 6], [nx + 175, ny + 20], [nx, ny + 2]], 'rgba(214,236,255,0.05)');
    this.paint.poly([[nx, ny], [nx + 90, ny - 2], [nx + 96, ny + 9], [nx, ny + 1]], 'rgba(214,236,255,0.05)');
    // Tail light glow behind the car.
    ctx.fillStyle = 'rgba(255,50,50,0.3)';
    ctx.fillRect(x - 3, bodyY + 4, 3, 5);
    ctx.drawImage(s.roadsterBody, x, bodyY);

    const gear = p.gear;
    if (gear < 1) {
      ctx.globalAlpha = 1 - gear * gear;
      for (const w of ROADSTER.wheels) {
        const size = Math.max(2, Math.round(w.r * 2 * (1 - 0.55 * gear)));
        const wy = top + w.y + droop - Math.round(gear * 7);
        ctx.drawImage(s.roadsterWheels[frame], Math.round(x + w.x - size / 2), Math.round(wy - size / 2), size, size);
      }
      ctx.globalAlpha = 1;
    }
    if (gear > 0.3) {
      const shown = clamp((gear - 0.3) / 0.5, 0, 1);
      ctx.globalAlpha = shown;
      ctx.drawImage(s.roadsterShip, x, bodyY);
      // Soft cyan underglow, gently pulsing.
      const pulse = 0.7 + 0.3 * Math.sin(this.clock * 9);
      ctx.fillStyle = `rgba(127,227,255,${(0.16 * pulse).toFixed(3)})`;
      ctx.fillRect(x + 6, bodyY + 18, 60, 2);
      ctx.fillStyle = `rgba(127,227,255,${(0.07 * pulse).toFixed(3)})`;
      ctx.fillRect(x + 2, bodyY + 20, 68, 2);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    this.drawJets();
  }

  /** Bright cores of the nitrogen jets: from each nozzle, straight down. */
  drawJets() {
    const p = this.player;
    const ctx = this.ctx;
    if (p.rearJet > 0.08) {
      // Tail thruster: a horizontal core blasting backward.
      const at = this.carPoint(REAR_NOZZLE.x, REAR_NOZZLE.y);
      const level = p.rearJet;
      const len = Math.round(8 + level * 20 + rand(0, 4));
      const ny = Math.round(at.y);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const h = 2 + Math.floor(i / 4);
        const alpha = Math.pow(1 - t, 1.1) * (0.25 + 0.75 * level);
        ctx.fillStyle = `rgba(232,250,255,${alpha.toFixed(3)})`;
        ctx.fillRect(Math.round(at.x) - 1 - i, Math.round(ny - h / 2 + (i > 5 ? rand(-0.6, 0.6) : 0)), 1, h);
        if (i === 3 || i === 8 || i === 14) {
          ctx.fillStyle = `rgba(255,255,255,${Math.min(1, alpha + 0.35).toFixed(3)})`;
          ctx.fillRect(Math.round(at.x) - 1 - i, ny, 1, 1);
        }
      }
      ctx.fillStyle = `rgba(190,240,255,${(0.6 * level).toFixed(3)})`;
      ctx.fillRect(Math.round(at.x) - 1, ny - 2, 1, 4);
    }
    ROADSTER.nozzles.forEach((n, j) => {
      const level = p.jets[j];
      if (level < 0.08) return;
      const at = this.carPoint(n.x, n.y);
      const nx = at.x;
      const ny = Math.round(at.y);
      const len = Math.round(6 + level * 14 + rand(0, 3));
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const w = 2 + Math.floor(i / 3);
        const cx = nx + n.dir * i * 0.3 + (i > 4 ? rand(-0.6, 0.6) : 0);
        const alpha = Math.pow(1 - t, 1.2) * (0.2 + 0.75 * level);
        ctx.fillStyle = `rgba(232,250,255,${alpha.toFixed(3)})`;
        ctx.fillRect(Math.round(cx - w / 2), ny + i, w, 1);
        if (i === 2 || i === 6 || i === 10) {
          // Shock diamonds: brighter knots in the jet.
          ctx.fillStyle = `rgba(255,255,255,${Math.min(1, alpha + 0.35).toFixed(3)})`;
          ctx.fillRect(Math.round(cx - 0.5), ny + i, 1, 1);
        }
      }
      ctx.fillStyle = `rgba(190,240,255,${(0.5 * level).toFixed(3)})`;
      ctx.fillRect(nx - 2, ny - 1, 4, 1);
    });
  }

  drawGas(front) {
    const ctx = this.ctx;
    for (const g of this.gas) {
      if (g.front !== front) continue;
      const t = g.age / g.life;
      // Expands fast at first, then billows slowly; fades in, then out.
      const size = Math.max(1, Math.round(g.size + g.grow * Math.sqrt(t)));
      const alpha = Math.pow(1 - t, 1.5) * Math.min(1, 0.45 + t * 6) * (front ? 0.3 : 0.4);
      const a = Math.min(15, Math.round(alpha * 15));
      if (a <= 0) continue;
      const c = Math.min(7, Math.floor((t * 1.4) * 7) + g.tint);
      ctx.fillStyle = GAS_STYLES[Math.min(7, c)][a];
      ctx.fillRect(Math.round(g.x - size / 2), Math.round(g.y - size / 2), size, size);
    }
  }

  drawSparks() {
    const ctx = this.ctx;
    for (const s of this.sparks) {
      ctx.globalAlpha = clamp(1 - s.age / s.life, 0, 1);
      ctx.fillStyle = s.color;
      ctx.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
      ctx.fillRect(Math.round(s.x - s.vx * 0.01), Math.round(s.y - s.vy * 0.01), 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  drawStreaks() {
    const ctx = this.ctx;
    for (const s of this.streaks) {
      ctx.fillStyle = `rgba(200,215,235,${s.alpha.toFixed(2)})`;
      ctx.fillRect(Math.round(s.x), Math.round(s.y), Math.round(s.len), 1);
    }
  }

  /**
   * The corner readouts: brand, speed and gauges top left, score top right.
   * On the big screen they sit on the game; on phones, on their own larger
   * panel above it.
   */
  drawCorners(ctx, width) {
    const p = this.player;

    // Brand mark.
    ctx.drawImage(this.sprites.logo, 12, 10);
    drawText(ctx, 'ROADSTER', 32, 13, '#dfe2e6');

    // Speed.
    const mph = String(this.state === 'title' ? 0 : this.mph).padStart(3, '0');
    const w = drawText(ctx, mph, 12, 30, '#f2f3f5', 2);
    drawText(ctx, 'MPH', 12 + w + 4, 37, '#7d838c');

    // Nitrogen gauge, and the boost meter under it, in one column.
    const gx = 46;
    const gw = 60;
    const gauge = (y, fill, color) => {
      ctx.fillStyle = '#1a1d23';
      ctx.fillRect(gx, y, gw, 5);
      if (color) {
        ctx.fillStyle = color;
        ctx.fillRect(gx, y, Math.round(gw * fill), 5);
      }
      ctx.fillStyle = '#0b0c0f';
      for (let x = gx + 6; x < gx + gw; x += 6) ctx.fillRect(x, y, 1, 5);
    };
    drawText(ctx, 'N2', 12, 52, '#7d838c');
    const low = p.tank < 0.25;
    const blinkOff = p.tank <= 0.02 && Math.sin(this.clock * 18) < 0;
    gauge(53, p.tank, blinkOff ? null : low ? (p.tank <= 0.02 ? '#ff3a3a' : '#ffa53d') : '#7fe3ff');
    this.drawBoostMeter(ctx, gauge, gx, gw);

    // Score, Chrome-dino style.
    const flashing = this.scoreFlash > 0 && Math.floor(this.scoreFlash * 8) % 2 === 0;
    const score = String(this.score).padStart(5, '0');
    if (!flashing) drawText(ctx, score, width - 12, 13, '#f2f3f5', 1, 'right');
    const scoreW = textWidth(score);
    drawText(ctx, 'HI ' + String(this.hiScore).padStart(5, '0'), width - 22 - scoreW, 13, '#7d838c', 1, 'right');
    // The credit tag sits under the score, so MUTED goes left of HI.
    if (this.muted) drawText(ctx, 'MUTED', width - 34 - scoreW - textWidth('HI 00000'), 13, '#7d838c', 1, 'right');
  }

  /** Everything drawn over the game: corners (big screen), callouts, points. */
  drawHud() {
    const ctx = this.ctx;
    if (!this.handheld) this.drawCorners(ctx, VIEW_W);

    // Top centre: boost status; else the boost prompt, which stays until
    // used, with any flip callout small beneath it; else a full-size flip
    // callout; else a speed banner.
    if (this.cruise) {
      this.drawBoostStatus();
    } else if (this.boostReady && this.state === 'playing') {
      this.drawBoostPrompt();
      if (this.trick) this.drawTrick(true);
    } else if (this.trick) {
      this.drawTrick();
    } else if (this.banner) {
      const t = this.banner.age;
      if (t < 1.2 || Math.floor(t * 10) % 2 === 0) {
        drawText(ctx, this.banner.str, UI_W / 2, 30, '#ffa53d', 2, 'center');
      }
    }

    for (const t of this.texts) {
      ctx.globalAlpha = clamp(1.2 - t.age, 0, 1);
      drawText(ctx, t.str, t.x / UI_ZOOM, t.y / UI_ZOOM, t.color, 1, 'center');
    }
    ctx.globalAlpha = 1;
  }

  /**
   * The flip callout, where the speed banners appear. Mid-air the points wait
   * dimmed under the name; on a clean landing they light up, then glide into
   * the score.
   */
  /**
   * The flip callout. Normally it takes the top centre: a big name, with the
   * points waiting dimmed under it until you land. When a boost is ready the
   * boost prompt keeps that spot and the callout shrinks to one line under
   * it (compact). Either way, on a clean landing the points flash and glide
   * into the score.
   */
  drawTrick(compact = false) {
    const ctx = this.ctx;
    const t = this.trick;
    const cx = UI_W / 2;
    const color = t.kind === 'back' ? '#ffa53d' : t.kind === 'front' ? '#7fe3ff' : '#ff3a3a';
    const labelScale = compact ? 1 : 2;
    const pointsScale = compact ? 1 : 2;
    const str = t.points ? `+${t.points}` : '';
    // Compact: name and points share one line under the boost prompt.
    const labelX = compact && str ? cx - (textWidth(str) + 6) / 2 : cx;
    const labelY = compact ? 53 : 22;
    const startX = compact ? labelX + (textWidth(t.label) + 6) / 2 + textWidth(str) / 2 : cx;
    const startY = compact ? 53 : 42;

    let labelAlpha = 1;
    if (t.phase === 'bank') labelAlpha = clamp(1 - (t.age - TRICK_GLIDE_START) / 0.35, 0, 1);
    if (t.phase === 'fail') labelAlpha = clamp(1.4 - t.age, 0, 1);
    if (labelAlpha > 0) {
      ctx.globalAlpha = labelAlpha;
      // Pops in a size larger for a moment.
      const pop = t.phase === 'air' && t.age < 0.12;
      const scale = pop ? labelScale + 1 : labelScale;
      drawText(ctx, t.label, labelX, labelY - (pop ? 2 : 0), color, scale, 'center');
      ctx.globalAlpha = 1;
    }
    if (!str) return;

    if (t.phase === 'air') {
      ctx.globalAlpha = 0.45 + 0.2 * Math.sin(this.clock * 12);
      drawText(ctx, str, startX, startY, color, pointsScale, 'center');
      ctx.globalAlpha = 1;
      return;
    }
    if (t.age < TRICK_GLIDE_START) {
      // Landed: points flash white before they move.
      const lit = Math.floor(t.age * 16) % 2 === 0;
      drawText(ctx, str, startX, startY, lit ? '#ffffff' : color, pointsScale, 'center');
      return;
    }
    const u = clamp((t.age - TRICK_GLIDE_START) / (TRICK_GLIDE_END - TRICK_GLIDE_START), 0, 1);
    const ease = (v) => (v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2);
    // Into the score: on the game, or up off the screen towards the panel.
    const scoreW = textWidth(String(this.score).padStart(5, '0'));
    const tx = this.handheld ? UI_W - 30 : VIEW_W - 12 - scoreW / 2;
    const ty = this.handheld ? -12 : 13;
    // Faint trail behind the travelling points.
    for (let g = 2; g >= 0; g--) {
      const e = ease(clamp(u - g * 0.12, 0, 1));
      if (g > 0 && e < 0.08) continue;
      ctx.globalAlpha = g === 0 ? 1 : 0.18 / g;
      drawText(ctx, str, lerp(startX, tx, e), lerp(startY, ty, e), color, e > 0.6 ? 1 : pointsScale, 'center');
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Boost meter: fills amber as you earn points yourself, glows and says
   * READY when full (only then can it fire), and drains while boosting.
   */
  drawBoostMeter(ctx, gauge, gx, gw) {
    const y = 64;
    const c = this.cruise;
    let fill;
    let color = '#ffa53d';
    if (c) {
      const gained = this.score - c.startScore;
      fill = c.phase === 'rise' || c.phase === 'cruise' ? clamp(1 - gained / TUNING.boostPoints, 0, 1) : 0;
      color = '#7fe3ff';
    } else {
      fill = clamp((this.score - this.boostChargeFrom) / TUNING.boostUnlock, 0, 1);
    }
    const full = this.boostReady && !c;
    if (full) {
      const pulse = Math.sin(this.clock * 8) > 0;
      color = pulse ? '#7fe3ff' : '#d8f7ff';
      ctx.fillStyle = 'rgba(127,227,255,0.22)';
      ctx.fillRect(gx - 1, y - 1, gw + 2, 7);
    }
    drawText(ctx, 'BOOST', 12, y - 1, full ? '#7fe3ff' : '#7d838c');
    gauge(y, fill, color);
    if (full && Math.floor(this.clock * 3) % 2 === 0) {
      drawText(ctx, 'READY', gx + gw + 5, y - 1, '#7fe3ff');
    }
  }

  /** "BOOST READY" with two SPACE (JUMP) keycaps tapping one after the other. */
  drawBoostPrompt() {
    const ctx = this.ctx;
    const cx = UI_W / 2;
    const key = this.handheld ? 'JUMP' : 'SPACE';
    ctx.globalAlpha = 0.7 + 0.3 * Math.sin(this.clock * 6);
    drawText(ctx, 'BOOST READY', cx, 16, '#7fe3ff', 2, 'center');
    ctx.globalAlpha = 1;
    const label = 'DOUBLE TAP';
    const lw = textWidth(label);
    const kw = 38;
    const left = Math.round(cx - (lw + 8 + kw * 2 + 4) / 2);
    drawText(ctx, label, left, 37, '#dfe2e6');
    const phase = (this.clock * 1.4) % 1;
    this.drawKeycap(left + lw + 8, 34, kw, 13, key, phase < 0.12);
    this.drawKeycap(left + lw + 8 + kw + 4, 34, kw, 13, key, phase > 0.22 && phase < 0.34);
  }

  /**
   * While boosting: title and how much of the 500 points is earned. The
   * wind-down and landing happen quietly, with nothing shown.
   */
  drawBoostStatus() {
    const ctx = this.ctx;
    const c = this.cruise;
    const cx = UI_W / 2;
    if (c.phase === 'rise' || c.phase === 'cruise') {
      const flash = c.t < 0.6 && Math.floor(c.t * 10) % 2 === 0;
      drawText(ctx, `BOOST X${TUNING.boostScoreRate}`, cx, 16, flash ? '#ffffff' : '#7fe3ff', 2, 'center');
      const w = 140;
      const x = Math.round(cx - w / 2);
      const frac = clamp((this.score - c.startScore) / TUNING.boostPoints, 0, 1);
      ctx.fillStyle = '#1a1d23';
      ctx.fillRect(x, 37, w, 5);
      ctx.fillStyle = '#7fe3ff';
      ctx.fillRect(x, 37, Math.round(w * frac), 5);
      ctx.fillStyle = '#0b0c0f';
      for (let i = x + 10; i < x + w; i += 10) ctx.fillRect(i, 37, 1, 5);
      drawText(ctx, `+${Math.min(TUNING.boostPoints, this.score - c.startScore)}`, x + w + 6, 36, '#7d838c');
    }
  }

  dim(alpha) {
    this.ctx.fillStyle = `rgba(4,5,7,${alpha})`;
    this.ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  drawTitle() {
    const ctx = this.ctx;
    this.dim(0.5);
    const cx = UI_W / 2;
    ctx.drawImage(this.sprites.logo, cx - 22, 22 + UI_Y, 45, 36);
    drawText(ctx, 'ROADSTER', cx, 66 + UI_Y, '#f2f3f5', 3, 'center');
    if (this.challengeScore) {
      drawText(ctx, 'BEAT ' + this.challengeScore + ' TO WIN!', cx, 93 + UI_Y, '#ffa53d', 1, 'center');
    } else {
      drawText(ctx, 'THE CAR THAT FLIES', cx, 93 + UI_Y, '#7d838c', 1, 'center');
    }
    if (Math.floor(this.clock * 2) % 2 === 0) {
      const launch = this.handheld ? 'TAP JUMP TO LAUNCH' : 'PRESS SPACE TO LAUNCH';
      drawText(ctx, launch, cx, 109 + UI_Y, '#7fe3ff', 1, 'center');
    }
    // On phones the keys under the screen are labelled; two tips will do.
    if (this.handheld) {
      drawText(ctx, 'HOLD JUMP TO FLY', cx, 129 + UI_Y, '#6a707a', 1, 'center');
      drawText(ctx, 'DOUBLE TAP IT TO BOOST', cx, 141 + UI_Y, '#6a707a', 1, 'center');
      return;
    }

    // The three controls, each a keycap in its own panel. The keys take
    // turns pressing down so they read as keys.
    const boxW = 132;
    const gap = 10;
    const left = Math.round(cx - (boxW * 3 + gap * 2) / 2);
    const top = 126 + UI_Y;
    const pressed = Math.floor(this.clock * 1.6) % 3;
    const controls = [
      {key: 'SPACE', label: 'JUMP / FLY', sub: 'TAP TWICE TO BOOST', color: '#7fe3ff'},
      {key: 'left', label: 'BACKFLIP +100', sub: 'HOLD TO KEEP FLIPPING', color: '#ffa53d'},
      {key: 'right', label: 'FRONT FLIP +75', sub: 'HOLD TO KEEP FLIPPING', color: '#7fe3ff'},
    ];
    controls.forEach((c, i) => {
      const x = left + i * (boxW + gap);
      this.drawPanel(x, top, boxW, 62);
      const keyW = c.key === 'SPACE' ? 64 : 24;
      this.drawKeycap(Math.round(x + (boxW - keyW) / 2), top + 9, keyW, 17, c.key, pressed === i);
      drawText(ctx, c.label, x + boxW / 2, top + 35, c.color, 1, 'center');
      drawText(ctx, c.sub, x + boxW / 2, top + 47, '#6a707a', 1, 'center');
    });
  }

  /** Dark panel with a 1px border and notched pixel corners. */
  drawPanel(x, y, w, h) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(13,15,20,0.92)';
    ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    ctx.fillStyle = '#333842';
    ctx.fillRect(x + 1, y, w - 2, 1);
    ctx.fillRect(x + 1, y + h - 1, w - 2, 1);
    ctx.fillRect(x, y + 1, 1, h - 2);
    ctx.fillRect(x + w - 1, y + 1, 1, h - 2);
  }

  /**
   * A keycap seen from the front: light face, darker lip underneath. When
   * pressed the face drops a pixel onto the lip.
   */
  drawKeycap(x, y, w, h, key, pressed) {
    const ctx = this.ctx;
    const drop = pressed ? 1 : 0;
    // Lip.
    ctx.fillStyle = '#6b717b';
    ctx.fillRect(x + 1, y + 3, w - 2, h - 3);
    ctx.fillRect(x, y + 4, w, h - 5);
    // Face, with notched corners and a highlight along the top.
    const fy = y + drop;
    const fh = h - 3;
    ctx.fillStyle = pressed ? '#c4c8cf' : '#dfe2e6';
    ctx.fillRect(x + 1, fy, w - 2, fh);
    ctx.fillRect(x, fy + 1, w, fh - 2);
    ctx.fillStyle = '#f7f8fa';
    ctx.fillRect(x + 1, fy, w - 2, 1);

    const iconY = fy + Math.round((fh - 7) / 2);
    if (key === 'left' || key === 'right') {
      const icon = key === 'left' ? this.sprites.arrowLeft : this.sprites.arrowRight;
      ctx.drawImage(icon, Math.round(x + (w - icon.width) / 2), iconY);
    } else {
      drawText(ctx, key, x + w / 2, iconY, '#15171c', 1, 'center');
    }
  }

  drawGameOver() {
    const ctx = this.ctx;
    this.dim(Math.min(0.55, this.overTime * 1.5));
    const cx = UI_W / 2;
    const logo = this.sprites.logo;
    ctx.drawImage(logo, Math.round(cx - logo.width / 2), 38 + UI_Y);
    drawText(ctx, 'GAME OVER', cx, 58 + UI_Y, '#f2f3f5', 3, 'center');
    const line = `SCORE ${String(this.score).padStart(5, '0')}`;
    drawText(ctx, line, cx, 96 + UI_Y, '#dfe2e6', 1, 'center');
    if (this.newBest) {
      if (Math.floor(this.clock * 4) % 2 === 0) drawText(ctx, 'NEW HIGH SCORE!', cx, 110 + UI_Y, '#ffa53d', 1, 'center');
    } else {
      drawText(ctx, `BEST ${String(this.hiScore).padStart(5, '0')}`, cx, 110 + UI_Y, '#7d838c', 1, 'center');
    }

    const b = BUTTON;
    const lit = this.buttonHover || this.buttonFocus;
    ctx.fillStyle = lit ? '#f2f3f5' : '#0e1015';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = '#f2f3f5';
    ctx.fillRect(b.x, b.y, b.w, 1);
    ctx.fillRect(b.x, b.y + b.h - 1, b.w, 1);
    ctx.fillRect(b.x, b.y, 1, b.h);
    ctx.fillRect(b.x + b.w - 1, b.y, 1, b.h);
    // Pixel-art corner notches.
    ctx.clearRect(b.x, b.y, 1, 1);
    ctx.clearRect(b.x + b.w - 1, b.y, 1, 1);
    ctx.clearRect(b.x, b.y + b.h - 1, 1, 1);
    ctx.clearRect(b.x + b.w - 1, b.y + b.h - 1, 1, 1);
    const label = 'PLAY AGAIN';
    const icon = lit ? this.sprites.restartDark : this.sprites.restart;
    const tw = textWidth(label, 2);
    const total = icon.width + 8 + tw;
    const left = Math.round(cx - total / 2);
    ctx.drawImage(icon, left, b.y + 9);
    drawText(ctx, label, left + icon.width + 8, b.y + 10, lit ? '#0b0c0f' : '#f2f3f5', 2);
    drawText(ctx, this.handheld ? 'OR TAP JUMP' : 'OR PRESS SPACE', cx, b.y + b.h + 9, '#565c66', 1, 'center');

    if (this.challengeScore) {
      const won = this.score >= this.challengeScore;
      const msg = 'CHALLENGE: ' + this.challengeScore + (won ? ' - YOU WIN!' : ' - SO CLOSE!');
      drawText(ctx, msg, cx, 192 + UI_Y, won ? '#4ade80' : '#ffa53d', 1, 'center');
    }

    const shareText = this.shareCopied > 0 ? 'LINK COPIED!' : 'SHARE SCORE';
    const shareColor = this.shareCopied > 0 ? '#4ade80' : (this.shareHover || this.shareFocus ? '#ffffff' : '#7fe3ff');
    drawText(ctx, shareText, cx, SHARE_BTN.y + 3, shareColor, 1, 'center');
  }

  drawPaused() {
    this.dim(0.5);
    drawText(this.ctx, 'PAUSED', UI_W / 2, 100 + UI_Y, '#f2f3f5', 3, 'center');
    drawText(this.ctx, this.handheld ? 'TAP JUMP TO CONTINUE' : 'PRESS SPACE TO CONTINUE',
        UI_W / 2, 134 + UI_Y, '#7fe3ff', 1, 'center');
  }

  // -------------------------------------------------------------------------
  // Layout

  /**
   * Lay out for the window's shape: a portrait (phone) window gets the
   * handheld layout, anything else the full-window one. Then rebuild what
   * depends on the view size.
   */
  resize() {
    const handheld = window.innerHeight > window.innerWidth;
    if (handheld !== this.handheld) {
      this.handheld = handheld;
      document.body.classList.toggle('handheld', handheld);
    }
    // Landscape on a touch device (phone held sideways): show floating flip
    // buttons over the game. Desktop landscape is left alone.
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const landscapeMobile = isTouchDevice && !handheld;
    document.body.classList.toggle('landscape-mobile', landscapeMobile);
    const oldGround = GROUND_Y;
    if (handheld) this.layoutHandheld();
    else this.layoutFull();
    this.canvas.width = VIEW_W;
    this.canvas.height = VIEW_H;
    this.canvas.style.width = `${VIEW_W * this.cssScale}px`;
    this.canvas.style.height = `${VIEW_H * this.cssScale}px`;
    this.buildBackground();

    // Keep anything on screen on the road as the road moves.
    const dy = GROUND_Y - oldGround;
    if (dy && this.player) {
      this.player.y += dy;
      this.player.support += dy;
      for (const list of [this.gas, this.sparks, this.texts]) {
        for (const item of list) item.y += dy;
      }
    }
    this.positionButton();
    this.paintLegends();
    this.placeCredit();
  }

  /**
   * Fill the stage (the window above the note). Pick a pixel size that keeps
   * the view at least 640 game pixels wide (and 270 tall), preferring a whole
   * number of device pixels per game pixel so every pixel is the same size;
   * the view then stretches to the window's shape, so tall windows get more
   * sky.
   */
  layoutFull() {
    const stage = this.canvas.parentElement;
    stage.style.width = '';
    stage.style.height = '';
    const dpr = window.devicePixelRatio || 1;
    const winW = Math.max(200, stage.clientWidth) * dpr;
    const winH = Math.max(120, stage.clientHeight) * dpr;
    const exact = Math.min(winW / MIN_VIEW_W, winH / MIN_VIEW_H);
    let s = Math.floor(exact);
    if (s < 1 || s < exact * 0.8) s = exact;
    setViewSize(Math.ceil(winW / s), Math.ceil(winH / s));
    this.cssScale = s / dpr;
  }

  /**
   * Phones, held upright: a 4:3 screen as wide as fits in its frame, the
   * HUD above it at about 2.5 times the game's pixel size, and the keys
   * below, as wide as the frame.
   * If it all comes out taller than the window, shrink the screen to fit.
   */
  layoutHandheld() {
    const con = this.console;
    let w = Math.min(window.innerWidth - 48, 560);
    for (let pass = 0; pass < 2; pass++) {
      this.sizeHandheld(w);
      const cs = getComputedStyle(con);
      const kids = [...con.children].filter((el) => el.offsetParent);
      const used = kids.reduce((sum, el) => sum + el.offsetHeight, 0) +
          parseFloat(cs.rowGap || 0) * (kids.length - 1) +
          parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const over = used - window.innerHeight;
      if (over <= 0) break;
      const flex = this.canvas.parentElement.offsetHeight + this.hud.offsetHeight;
      w = Math.max(240, w * (flex - over) / flex);
    }
  }

  sizeHandheld(w) {
    const dpr = window.devicePixelRatio || 1;
    w = Math.floor(w);
    const h = Math.round(w * 3 / 4);
    setViewSize(MIN_VIEW_W, MIN_VIEW_W * 3 / 4, 2);
    this.cssScale = w / VIEW_W;
    const stage = this.canvas.parentElement;
    stage.style.width = `${w}px`;
    stage.style.height = `${h}px`;
    const frameW = this.screenFrame.offsetWidth;
    // The HUD: whole device pixels per HUD pixel, so it is crisp.
    const unit = Math.max(1, Math.round(frameW * dpr / 256));
    this.hud.width = Math.floor(frameW * dpr / unit);
    this.hud.height = 70;
    this.hud.style.width = `${this.hud.width * unit / dpr}px`;
    this.hud.style.height = `${this.hud.height * unit / dpr}px`;
    // The keys' wells (6px round each cap) line up with the frame.
    this.pad.style.width = `${frameW - 12}px`;
  }

  /**
   * Paints the pixel legends and labels of the phone keys, and the note,
   * each at a whole number of device pixels per pixel.
   */
  paintLegends() {
    const dpr = window.devicePixelRatio || 1;
    const paint = (canvas, src, unit) => {
      canvas.width = src.width;
      canvas.height = src.height;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, src.width, src.height);
      ctx.drawImage(src, 0, 0);
      canvas.style.width = `${src.width * unit / dpr}px`;
      canvas.style.height = `${src.height * unit / dpr}px`;
    };
    const words = (str, color) => {
      const c = makeCanvas(textWidth(str), 7);
      drawText(c.getContext('2d'), str, 0, 0, color);
      return c;
    };
    for (const [kind, el] of Object.entries(this.keys)) {
      paint(el.querySelector('canvas'), this.sprites.keyIcons[kind], Math.max(2, Math.round(2.2 * dpr)));
      const label = el.parentElement.querySelector('.label');
      paint(label, words(el.getAttribute('aria-label').toUpperCase(), '#7d838c'), Math.max(1, Math.round(1.4 * dpr)));
    }
    const text = words(this.note.textContent.toUpperCase(), '#5a606a');
    const room = (window.innerWidth - 32) * dpr / text.width;
    paint(this.note.previousElementSibling, text, Math.max(1, Math.floor(Math.min(room, 1.4 * dpr))));
  }

  /**
   * The credit tag: under the score, right edges lined up, its pixels the
   * size of the score's (on the game, or on the phone layout's HUD).
   */
  placeCredit() {
    const dpr = window.devicePixelRatio || 1;
    let px;
    let right;
    let top;
    if (this.handheld) {
      const r = this.hud.getBoundingClientRect();
      px = r.width / this.hud.width;
      right = r.right;
      top = r.top + 21 * px;
    } else {
      const r = this.canvas.parentElement.getBoundingClientRect();
      px = this.cssScale;
      right = r.left + (VIEW_W - 12) * px;
      top = r.top + 25 * px;
    }
    const u = Math.max(1, Math.round(px * dpr)) / dpr;
    const img = this.sprites.credit;
    const c = this.credit.firstElementChild;
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    c.style.width = `${img.width * u}px`;
    c.style.height = `${img.height * u}px`;
    Object.assign(this.credit.style, {
      right: `${window.innerWidth - right}px`,
      top: `${top}px`,
      padding: `${3 * u}px ${5 * u}px`,
      borderRadius: `${3 * u}px`,
    });
  }

  positionButton() {
    const s = this.cssScale * UI_ZOOM;
    if (this.button) {
      Object.assign(this.button.style, {
        left: `${BUTTON.x * s}px`,
        top: `${BUTTON.y * s}px`,
        width: `${BUTTON.w * s}px`,
        height: `${BUTTON.h * s}px`,
      });
    }
    if (this.shareButton) {
      Object.assign(this.shareButton.style, {
        left: `${SHARE_BTN.x * s}px`,
        top: `${SHARE_BTN.y * s}px`,
        width: `${SHARE_BTN.w * s}px`,
        height: `${SHARE_BTN.h * s}px`,
      });
    }
  }
}

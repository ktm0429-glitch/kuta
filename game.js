'use strict';

/* =====================================================================
   ホームラン競争 - Home Run Derby (fan-made unofficial clone)

   Gameplay/physics faithfully re-implements the mechanics of a classic
   browser home-run-derby minigame: 10 pitches, drag-to-adjust batter
   stance, tap/click-release swing timing, curve/shoot/straight pitches,
   angle-based hit judgement, and a pseudo-3D outfield fly-ball/fence
   judgement. All art and sound in this file are original (drawn with
   canvas primitives / synthesized with WebAudio) rather than copied
   from any existing game.
   ===================================================================== */

const STAGE_W = 700, STAGE_H = 420;
const MAX_BALL_COUNT = 5;
const LASTPOS = 430;      // y where a pitch reaches the catcher's mitt
const MOUND_X = 350, MOUND_Y = 100; // pitcher's mound position (screen fits mound-to-home only)
const PITCH_START_Y = MOUND_Y; // y where the ball leaves the pitcher's hand
const CURVE_START_Y = 150;// y after which curve/shoot pitches start bending
const BAT_CONTACT_Y = 300;
const HOMERUN_WAIT = 40;
const PERFECT_EXTRA_WAIT = 100;

const canvas = document.getElementById('field');
const ctx = canvas.getContext('2d');
const btnStart = document.getElementById('btnStart');
const btnBoxChange = document.getElementById('btnBoxChange');

// Render at native pixel density so detailed art stays crisp on hi-DPI screens.
const DPR = Math.min(window.devicePixelRatio || 1, 2);
canvas.width = STAGE_W * DPR;
canvas.height = STAGE_H * DPR;
ctx.scale(DPR, DPR);

// Deterministic pseudo-random (stable across frames, no per-frame flicker in textures).
function pseudo(i) {
	const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
	return x - Math.floor(x);
}

/* ---------------------------- state ---------------------------- */

let gammingFlg = false;   // true from pitch start until result is settled
let homerunFlg = false;   // true while the home-run celebration plays
let ballCount = 0;
let homerunCount = 0;
let box = 1;              // 1: left batter's box, 2: right batter's box
let Dir = "";             // "" pitch / L,C,R hit toward outfield / L2,C2,R2 outfield flight
let updateTimer = null;

let nowMouseX = STAGE_W / 2;
let initialMouseX = STAGE_W / 2;
let pointerDown = false;

let currentView = 'home'; // 'home' | 'left' | 'center' | 'right'

let perfectFlg = false;
let centerLineHeight = 0;
let centerLineWidth = 600;
const maxCenterLineHeight = 200;
let centerLineWidth2 = 0;
const centerLineHeight2 = 180;
let homerunTextScale = 0;
let perfectTextScale = 0;
let waitCount = 0;
let soundFirst = true;
let lastHomerunDistance = 0;
let pitchResults = []; // per-pitch outcome log: {result:'miss'|'hit'|'homerun', distance?}

const batterPosX = 310, batterPosY = 392; // batter's foot position, near home plate
const pitchLogEl = document.getElementById('pitchLog');

function renderPitchLog() {
	if (!pitchLogEl) return;
	pitchLogEl.innerHTML = pitchResults.map((r, i) => {
		let label, cls;
		if (r.result === 'homerun') { label = `ホームラン ${r.distance}m`; cls = 'homerun'; }
		else if (r.result === 'hit') { label = 'ヒット'; cls = 'hit'; }
		else { label = '空振り'; cls = 'miss'; }
		return `<span class="pitch-chip pitch-${cls}">${i + 1}球目 ${label}</span>`;
	}).join('');
}

/* --------------------------- audio ------------------------------ */

const AudioCtx = window.AudioContext || window.webkitAudioContext;
const actx = AudioCtx ? new AudioCtx() : null;

function unlockAudio() {
	if (actx && actx.state === 'suspended') actx.resume();
}

function soundHit() {
	if (!actx) return;
	const t0 = actx.currentTime;
	const osc = actx.createOscillator();
	const gain = actx.createGain();
	osc.type = 'square';
	osc.frequency.setValueAtTime(1200, t0);
	osc.frequency.exponentialRampToValueAtTime(200, t0 + 0.09);
	gain.gain.setValueAtTime(0.35, t0);
	gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
	osc.connect(gain).connect(actx.destination);
	osc.start(t0);
	osc.stop(t0 + 0.13);
}

function soundHomerun() {
	if (!actx) return;
	const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
	notes.forEach((freq, i) => {
		const t0 = actx.currentTime + i * 0.11;
		const osc = actx.createOscillator();
		const gain = actx.createGain();
		osc.type = 'triangle';
		osc.frequency.setValueAtTime(freq, t0);
		gain.gain.setValueAtTime(0.0001, t0);
		gain.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02);
		gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
		osc.connect(gain).connect(actx.destination);
		osc.start(t0);
		osc.stop(t0 + 0.4);
	});
}

/* --------------------------- pitcher ----------------------------- */

const pitcherCnt = [0, 25, 35, 36, 65];
const pitcher = {
	x: MOUND_X, y: MOUND_Y, timeCnt: 0, indexNo: -1, sceneNo: 0, show: true, // x/y is the foot/mound contact point
	initMe() { this.timeCnt = 0; this.indexNo = -1; this.sceneNo = 0; },
	startThrow() {
		if (!this.show) return;
		this.initMe();
		this.indexNo = 0;
		this.sceneNo = -1;
	},
	moveMe() {
		if (!this.show || this.indexNo < 0) return;
		this.timeCnt++;
		if (this.indexNo >= pitcherCnt.length) return;
		if (this.timeCnt >= pitcherCnt[this.indexNo]) {
			this.indexNo++;
			this.sceneNo++;
			if (pitcherCnt.length <= this.sceneNo) this.sceneNo = pitcherCnt.length - 1;
			if (this.sceneNo === 2) {
				ball.initMe(MOUND_X, PITCH_START_Y);
				ball.show = true;
			}
		}
	},
	dispMe() {
		if (!this.show) return;
		if (this.sceneNo >= 0) drawPitcherSprite(this.sceneNo, this.x, this.y);
	}
};

/* ---------------------------- batter ------------------------------ */

const batterCnt = [0, 1, 3, 15];
const batter = {
	x: batterPosX, y: batterPosY, timeCnt: 0, indexNo: -1, sceneNo: 0, show: true,
	initMe() { this.timeCnt = 0; this.indexNo = -1; this.sceneNo = 0; },
	startSwing() {
		if (!this.show) return;
		this.timeCnt = 0;
		this.indexNo = 0;
		this.sceneNo = -1;
	},
	moveMe() {
		if (!this.show || this.indexNo < 0) return;
		this.timeCnt++;
		if (this.indexNo >= batterCnt.length) return;
		if (this.timeCnt >= batterCnt[this.indexNo]) {
			this.indexNo++;
			this.sceneNo++;
			if (batterCnt.length <= this.sceneNo) this.sceneNo = batterCnt.length - 1;
		}
	},
	dispMe() {
		if (!this.show) return;
		if (this.sceneNo >= 0) {
			let x = batterPosX + (nowMouseX - initialMouseX) / 2;
			if (x < 294) x = 294;
			else if (x > 330) x = 330;
			if (box === 2) x -= 250;
			this.x = x;

			// Visual placement only (keeps this.x untouched for hit-judgement math):
			// mirror box2's stance back onto the right-hand batter's box on screen.
			const renderX = (box === 2) ? (700 - (this.x + 250)) : this.x;
			drawBatterSprite(this.sceneNo, renderX, this.y, box);
		}
	},
	show_me(f) { this.show = f; }
};

/* ----------------------------- ball ------------------------------- */

const ball = {
	x: 0, y: 0, lastX: 0, lastY: 0, width: 0, height: 0, speed: 0,
	moveKind: 0, show: false,
	firstsize: 5, lastsize: 10,
	hitedballSpeed: -60,
	firstX: 0, firstY: 0,
	kakuH: 0, kakuHSave: 0,
	offsetX: 0, offsetY: 0,
	vrd: 0,
	dispCyc: 0.3,
	eyeX: 0, eyeY: 0, eyeZ: 0,
	count: 0,
	hitBallSpeed: 0,
	shadeInitWidth: 5,
	sizeFixValue: 4000,

	initMe(ix, iy) {
		this.x = ix; this.y = iy;
		this.firstX = ix; this.firstY = iy;
		this.width = this.firstsize; this.height = this.firstsize;
		this.speed = Math.floor(Math.random() * 10) + 10;
		this.moveKind = Math.floor(Math.random() * 3);
		this.show = false;
		this.count = 0;
	},

	moveMe() {
		if (!this.show) return;
		const changeQnt = 3;

		if (this.show && this.y < LASTPOS) {
			this.lastX = this.x; this.lastY = this.y;

			if (Dir === "") {
				// on the way to the plate: straight / curve / shoot
				if (this.moveKind === 1 && this.y > CURVE_START_Y) {
					this.x += Math.floor(Math.random() * changeQnt);
				} else if (this.moveKind === 2 && this.y > CURVE_START_Y) {
					this.x -= Math.floor(Math.random() * changeQnt);
				} else {
					this.x += Math.floor(Math.random() * 3);
				}
				if (box === 1 && this.x > 400) this.x = 400;
				else if (box === 2 && this.x < 300) this.x = 300;

				this.y += this.speed;
				this.width = this.firstsize + (this.lastsize - this.firstsize) * ((this.y - this.firstY) / (LASTPOS - this.firstY));

			} else if (Dir === "R" || Dir === "C" || Dir === "L") {
				// batted ball heading toward the outfield, still in "home plate view"
				if (Dir === "R") this.x = this.x + (60 - this.kakuH);
				else if (Dir === "L") this.x = this.x - (60 - this.kakuH);
				else this.x = this.x + (90 - this.kakuH);

				this.y += this.speed;
				this.width = this.firstsize + (this.lastsize - this.firstsize) * ((this.y - this.firstY) / (LASTPOS - this.firstY));

			} else {
				// outfield pseudo-3d flight: L2 / C2 / R2
				if (Dir === "R2") { this.eyeX = 300; this.eyeY = 420; this.eyeZ = 500; }
				else if (Dir === "L2") { this.eyeX = 300; this.eyeY = 420; this.eyeZ = 500; }
				else if (Dir === "C2") {
					this.eyeX = 300; this.eyeY = 0; this.eyeZ = 600;
					this.kakuH = (this.kakuHSave - 90) * 1;
					this.offsetX = -1 * STAGE_W / 2 - this.kakuH * 4;
					this.offsetY = 140;
				}

				const spd = this.hitBallSpeed * this.count;
				const radV = Math.PI * (this.vrd / 180);
				const radH = Math.PI * (this.kakuH / 180);
				const g = ((9.8 * Math.pow(this.count, 2)) / 2) * 1.0;
				const realZ = spd * Math.sin(radV) - g;      // height
				const realD = spd * Math.cos(radV);           // distance from home
				const realY = realD * Math.sin(radH);
				const realX = realD * Math.cos(radH);
				let wallPlus = 0;
				const wallHeight = 190;

				if (10 < shade.x && shade.x < 700 && 10 < shade.y && shade.y < 420) shade.show = true;
				else shade.show = false;

				const x1 = realX, y1 = realY;
				shade.x = STAGE_W - (this.eyeX * ((y1 - this.eyeY) / (this.eyeX + x1)) + this.eyeY) + this.offsetX;
				shade.y = STAGE_H - ((this.eyeZ) / (this.eyeX + x1)) * x1 + this.offsetY;
				if (Dir === "L2") shade.x = STAGE_W - shade.x;

				this.x = shade.x;
				this.y = STAGE_H - realZ - 20;

				const ts = Math.sqrt(Math.pow(realD + this.eyeX, 2) + Math.pow(realY - this.eyeY, 2));
				shade.width = this.shadeInitWidth * ((this.sizeFixValue - ts) / this.sizeFixValue);
				shade.height = shade.width;
				this.width = shade.width;
				this.height = this.width;

				this.count += this.dispCyc;

				// home-run / fly-out judgement
				if (Dir === "L2") {
					if (260 <= shade.x && shade.y <= 260) {
						if (realZ > wallHeight) wallPlus = 68;
						else { pitchResults.push({ result: 'hit' }); renderPitchLog(); nextBall(); return; }
					}
				} else if (Dir === "R2") {
					if (shade.x <= 436 && shade.y <= 260) {
						if (realZ > wallHeight) wallPlus = 68;
						else { pitchResults.push({ result: 'hit' }); renderPitchLog(); nextBall(); return; }
					}
				} else {
					const cx = 350, cy = 1036, cr = 2100;
					const yy = cy - Math.sqrt(Math.pow(cr, 2) - Math.pow(shade.x - cx, 2)) + 1260;
					if (shade.y < yy) {
						if (realZ > wallHeight + 66) wallPlus = 70;
						else { pitchResults.push({ result: 'hit' }); renderPitchLog(); nextBall(); return; }
					}
				}

				shade.y -= wallPlus;

				if (shade.y - this.y <= 10) {
					shade.show = false;
					this.y = shade.y;
					if (wallPlus > 0) {
						homerunCount++;
						homerunFlg = true;
						perfectFlg = false;
						centerLineHeight = 0;
						centerLineWidth2 = 0;
						homerunTextScale = 0;
						perfectTextScale = 0;
						waitCount = 0;
						// Display-only estimated distance, driven by how well the ball was hit.
						const power = (this.hitBallSpeed - 65) / (115 - 65); // 0 (just enough) .. 1 (full power)
						lastHomerunDistance = Math.round(96 + power * 68 + Math.random() * 8);
						pitchResults.push({ result: 'homerun', distance: lastHomerunDistance });
						renderPitchLog();
						soundHomerun();
						return;
					}
					pitchResults.push({ result: 'hit' });
					renderPitchLog();
					nextBall();
					return;
				}
			}
		}

		if (this.show && this.y >= LASTPOS) {
			gammingFlg = false;
			this.show = false;
			pitchResults.push({ result: 'miss' });
			renderPitchLog();
		}

		if (this.show && this.y < 0 && (Dir === "L" || Dir === "C" || Dir === "R")) {
			this.y = 0;
			batter.show_me(false);
			pitcher.show = false;
			currentView = Dir === "L" ? 'left' : (Dir === "C" ? 'center' : 'right');
			Dir = Dir + "2";
		}
	},

	dispMe() {
		if (!this.show) return;
		ctx.save();
		ctx.beginPath();
		ctx.fillStyle = "rgb(220,220,220)";
		ctx.arc(this.x, this.y, Math.max(this.width, 0.1), 0, Math.PI * 2, true);
		ctx.fill();
		ctx.beginPath();
		ctx.fillStyle = "rgb(235,235,235)";
		ctx.arc(this.x, this.y, Math.max(this.width * 0.9, 0.1), 0, Math.PI * 2, true);
		ctx.fill();
		ctx.beginPath();
		ctx.fillStyle = "#fff";
		ctx.arc(this.x, this.y, Math.max(this.width * 0.8, 0.1), 0, Math.PI * 2, true);
		ctx.fill();

		// stitching accent
		if (this.width > 2) {
			ctx.strokeStyle = "rgba(200,50,50,0.6)";
			ctx.lineWidth = Math.max(this.width * 0.12, 0.4);
			ctx.beginPath();
			ctx.arc(this.x, this.y, this.width * 0.5, 0.3, 1.6);
			ctx.stroke();
		}

		if (Dir === "") {
			ctx.beginPath();
			ctx.fillStyle = "rgba(60,60,60,0.35)";
			ctx.ellipse(this.x, Math.min(this.y * 1.3, STAGE_H - 4), this.width * 1.1, this.width * 0.5, 0, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.restore();
	},

	show_me(f) { this.show = f; },

	hittingJudge() {
		if (Dir !== "" || this.show === false) return;

		let batX;
		if (box === 1) batX = batter.x + 120;
		else batX = batter.x + 206;
		const batY = BAT_CONTACT_Y;
		const ballX = this.x, ballY = this.y;
		const lastX = this.lastX, lastY = this.lastY;

		const rote1 = Math.atan2((ballY - lastY), (lastX - ballX)) * 180 / Math.PI;
		const rote2 = Math.atan2((batY - ballY), Math.abs(ballX - batX)) * 180 / Math.PI;
		let rote4 = 180 - rote1 - 2 * rote2;
		if (box === 2) rote4 = 180 - rote1 + 2 * rote2;

		const dist = Math.sqrt(Math.pow((ballX - batX), 2) + Math.pow((ballY - batY), 2));

		if (150 < dist || 230 > ballY || ballY > 390) return;

		if (0 < rote4 && rote4 <= 70) {
			this.kakuH = 20 * ((rote4 - 0) / 70) + 10;
			this.offsetX = -200 * ((rote4 - 0) / 70);
			this.offsetY = 180;
			Dir = "R";
		} else if (110 <= rote4 && rote4 < 180) {
			this.kakuH = 20 * ((180 - rote4) / 80) + 10;
			this.offsetX = -200 * ((180 - rote4) / 70);
			this.offsetY = 180;
			Dir = "L";
		} else if (70 < rote4 && rote4 < 110) {
			this.kakuH = 30 * ((rote4 - 90) / 20) + 90;
			this.kakuHSave = this.kakuH;
			Dir = "C";
			this.speed = this.speed * 0.5;
		} else {
			return;
		}

		soundHit();

		if (this.show === true) {
			let d = dist < 0 ? 0 : dist;
			const shin = 100;
			let sabun = Math.abs(shin - d) * 5;
			if (sabun > shin) sabun = shin;
			const sure = 30 * ((shin - sabun) / shin);
			this.speed = this.hitedballSpeed;
			this.hitBallSpeed = 50 * (sure / 30) + 65;
			this.vrd = Math.floor(Math.random() * 10) + 50;
		}
	}
};

/* ----------------------------- shade ------------------------------ */

const shade = {
	x: 0, y: 0, width: 5, height: 5, show: false,
	dispMe() {
		if (!this.show) return;
		ctx.beginPath();
		ctx.fillStyle = "rgba(30,60,30,0.45)";
		ctx.ellipse(this.x, this.y, Math.max(this.width, 0.1), Math.max(this.width * 0.45, 0.1), 0, 0, Math.PI * 2);
		ctx.fill();
	},
	show_me(f) { this.show = f; }
};

/* ------------------------- game flow ------------------------------ */

function initGame() {
	gammingFlg = false;
	ball.show_me(false);
	shade.show_me(false);
	currentView = 'home';
	batter.show_me(true);
	pitcher.show = true;
	batter.initMe();
	pitcher.initMe();
	btnStart.style.visibility = 'visible';
	btnBoxChange.style.visibility = 'visible';
	drawScene();
}

function nextBall() {
	currentView = 'home';
	shade.show_me(false);
	ball.show_me(false);
	pitcher.show = true;
	pitcher.initMe();
	batter.show_me(true);
	batter.initMe();
	gammingFlg = false;
	btnBoxChange.style.visibility = 'visible';
}

function startGame() {
	unlockAudio();
	btnStart.style.visibility = 'hidden';
	ballCount = 0;
	homerunCount = 0;
	pitchResults = [];
	renderPitchLog();
	initialMouseX = nowMouseX;
	if (updateTimer) clearInterval(updateTimer);
	updateTimer = setInterval(drawTimer, 80);
}

function boxChange() {
	box = (box === 1) ? 2 : 1;
}

function startSwing() {
	if (gammingFlg) batter.startSwing();
	ball.hittingJudge();
}

/* --------------------------- main loop ----------------------------- */

function drawTimer() {
	ctx.clearRect(0, 0, STAGE_W, STAGE_H);
	drawBackground();

	if (homerunFlg) {
		drawHomerunCelebration();
		return;
	}

	if (ballCount <= MAX_BALL_COUNT) {
		if (!gammingFlg) {
			gammingFlg = true;
			ballCount++;
			if (ballCount > MAX_BALL_COUNT) return;
			Dir = "";
			pitcher.startThrow();
		}
	} else {
		clearInterval(updateTimer);
		initGame();
		return;
	}

	pitcher.moveMe();
	ball.moveMe();
	batter.moveMe();

	batter.dispMe();
	pitcher.dispMe();
	ball.dispMe();
	shade.dispMe();

	drawHUD();
}

/* --------------------------- rendering ------------------------------ */

function drawBackground() {
	if (homerunFlg || currentView !== 'home') {
		if (currentView === 'home') drawHomeBG();
		else drawOutfieldBG(currentView);
	} else {
		drawHomeBG();
	}
}

function drawHomeBG() {
	// Deliberately shows only the mound-to-home stretch (not the whole diamond),
	// so that distance fills the screen instead of looking cramped.
	const fenceY = 58;

	// sky
	const sky = ctx.createLinearGradient(0, 0, 0, fenceY);
	sky.addColorStop(0, '#bfe3ff');
	sky.addColorStop(1, '#e9f7ff');
	ctx.fillStyle = sky;
	ctx.fillRect(0, 0, STAGE_W, fenceY);

	// grass
	const grass = ctx.createLinearGradient(0, fenceY, 0, STAGE_H);
	grass.addColorStop(0, '#5a9a4a');
	grass.addColorStop(1, '#7cc36b');
	ctx.fillStyle = grass;
	ctx.fillRect(0, fenceY, STAGE_W, STAGE_H - fenceY);

	// mowing stripes
	ctx.fillStyle = 'rgba(255,255,255,0.07)';
	for (let i = 0; i < 6; i++) {
		if (i % 2 === 0) ctx.fillRect(i * (STAGE_W / 6), fenceY, STAGE_W / 6, STAGE_H - fenceY);
	}

	// outfield wall
	ctx.fillStyle = '#2f4f2f';
	ctx.fillRect(0, fenceY - 8, STAGE_W, 9);

	// foul lines running from home plate up to the fence corners
	ctx.strokeStyle = '#fff';
	ctx.lineWidth = 3;
	ctx.beginPath();
	ctx.moveTo(base_center(), 392);
	ctx.lineTo(65, fenceY);
	ctx.moveTo(base_center(), 392);
	ctx.lineTo(635, fenceY);
	ctx.stroke();

	// dirt path connecting the mound to home plate
	ctx.fillStyle = '#c68a52';
	ctx.beginPath();
	ctx.moveTo(base_center() - 20, MOUND_Y + 10);
	ctx.lineTo(base_center() - 60, 392);
	ctx.lineTo(base_center() + 60, 392);
	ctx.lineTo(base_center() + 20, MOUND_Y + 10);
	ctx.closePath();
	ctx.fill();

	// home plate dirt circle
	ctx.fillStyle = '#c68a52';
	ctx.beginPath();
	ctx.ellipse(base_center(), 385, 78, 40, 0, 0, Math.PI * 2);
	ctx.fill();

	// pitcher's mound
	ctx.fillStyle = '#d29a63';
	ctx.beginPath();
	ctx.ellipse(MOUND_X, MOUND_Y, 40, 20, 0, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = '#e8d3b0';
	ctx.fillRect(MOUND_X - 6, MOUND_Y - 4, 12, 5);

	// batter boxes
	ctx.strokeStyle = 'rgba(255,255,255,0.85)';
	ctx.lineWidth = 2;
	ctx.strokeRect(base_center() - 55, 355, 34, 46);
	ctx.strokeRect(base_center() + 21, 355, 34, 46);

	// home plate (drawn extra large so it reads clearly on screen)
	ctx.fillStyle = '#fff';
	ctx.strokeStyle = 'rgba(0,0,0,0.25)';
	ctx.lineWidth = 1.5;
	ctx.beginPath();
	ctx.moveTo(base_center() - 22, 388);
	ctx.lineTo(base_center() + 22, 388);
	ctx.lineTo(base_center() + 22, 402);
	ctx.lineTo(base_center(), 416);
	ctx.lineTo(base_center() - 22, 402);
	ctx.closePath();
	ctx.fill();
	ctx.stroke();
}

function base_center() { return 350; }

// The fence must be drawn at the exact screen height the home-run judgement
// logic uses (see the L2/R2/C2 branch in ball.moveMe), otherwise a ball can be
// ruled a home run while it still visually looks short of the wall. L2/R2
// judge a flat threshold at y=260; C2 judges a curved threshold (deeper,
// like a real center-field fence) using the same cx/cy/cr constants.
function fenceYAt(dir, x) {
	if (dir === 'center') {
		const cx = 350, cy = 1036, cr = 2100;
		return cy - Math.sqrt(Math.pow(cr, 2) - Math.pow(x - cx, 2)) + 1260;
	}
	return 260;
}

function drawOutfieldBG(dir) {
	const padH = 10;   // bottom kick-padding strip
	const boardH = 24; // ad-board strip
	const capH = 5;    // top cap rail
	const wallH = padH + boardH + capH;
	const wallTopAt = (x) => fenceYAt(dir, x) - wallH;
	const pathAlong = (yFn) => { ctx.moveTo(0, yFn(0)); for (let x = 10; x <= STAGE_W; x += 10) ctx.lineTo(x, yFn(x)); };

	// ---- sky -------------------------------------------------------
	const sky = ctx.createLinearGradient(0, 0, 0, 170);
	sky.addColorStop(0, '#1f78d1');
	sky.addColorStop(0.55, '#4fa3ea');
	sky.addColorStop(1, '#dcefff');
	ctx.fillStyle = sky;
	ctx.fillRect(0, 0, STAGE_W, 170);

	// sun glow
	const sunX = dir === 'left' ? 610 : 90;
	const glow = ctx.createRadialGradient(sunX, 34, 4, sunX, 34, 85);
	glow.addColorStop(0, 'rgba(255,250,225,0.9)');
	glow.addColorStop(1, 'rgba(255,250,225,0)');
	ctx.fillStyle = glow;
	ctx.fillRect(sunX - 90, -50, 180, 170);

	// layered clouds (soft double-blob for volume)
	[[130, 42, 26], [340, 30, 20], [520, 50, 30], [605, 34, 18]].forEach(([cx, cy, r], i) => {
		ctx.fillStyle = 'rgba(255,255,255,0.55)';
		ctx.beginPath(); ctx.ellipse(cx + 6, cy + 4, r * 1.15, r * 0.62, 0, 0, Math.PI * 2); ctx.fill();
		ctx.fillStyle = 'rgba(255,255,255,0.92)';
		ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
		ctx.beginPath(); ctx.ellipse(cx - r * 0.7, cy + 3, r * 0.6, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
	});

	// ---- distant haze (atmospheric perspective near the horizon) --
	const haze = ctx.createLinearGradient(0, 120, 0, 170);
	haze.addColorStop(0, 'rgba(220,235,250,0)');
	haze.addColorStop(1, 'rgba(220,235,250,0.75)');
	ctx.fillStyle = haze;
	ctx.fillRect(0, 120, STAGE_W, 50);

	// ---- city skyline (shaded, lit windows, rooftop details) ------
	const buildings = [
		{ x: -10, w: 66, h: 32 }, { x: 48, w: 40, h: 60, antenna: true }, { x: 90, w: 52, h: 28 },
		{ x: 150, w: 34, h: 22 },
		{ x: 400, w: 44, h: 30 }, { x: 442, w: 44, h: 58, tank: true }, { x: 494, w: 56, h: 26 },
		{ x: 558, w: 46, h: 44 }, { x: 612, w: 58, h: 22 }, { x: 664, w: 40, h: 34, antenna: true },
	];
	buildings.forEach(b => {
		const top = 150 - b.h;
		const bg = ctx.createLinearGradient(0, top, 0, 150);
		bg.addColorStop(0, '#b7c9dd');
		bg.addColorStop(1, '#8fa4bc');
		ctx.fillStyle = bg;
		ctx.fillRect(b.x, top, b.w, b.h);
		ctx.fillStyle = 'rgba(255,255,255,0.35)';
		ctx.fillRect(b.x, top, 2, b.h);
		if (b.antenna) {
			ctx.strokeStyle = '#8fa4bc'; ctx.lineWidth = 1.5;
			ctx.beginPath(); ctx.moveTo(b.x + b.w / 2, top); ctx.lineTo(b.x + b.w / 2, top - 12); ctx.stroke();
			ctx.fillStyle = '#e05a5a'; ctx.beginPath(); ctx.arc(b.x + b.w / 2, top - 12, 1.6, 0, Math.PI * 2); ctx.fill();
		}
		if (b.tank) {
			ctx.fillStyle = '#7f93aa';
			ctx.fillRect(b.x + b.w / 2 - 7, top - 9, 14, 8);
			ctx.beginPath(); ctx.ellipse(b.x + b.w / 2, top - 9, 7, 2.4, 0, 0, Math.PI * 2); ctx.fill();
		}
		for (let wx = b.x + 4; wx < b.x + b.w - 3; wx += 7) {
			for (let wy = top + 5; wy < 146; wy += 8) {
				const lit = pseudo(wx * 3 + wy * 7 + b.x) > 0.6;
				ctx.fillStyle = lit ? 'rgba(255,225,140,0.85)' : 'rgba(255,255,255,0.28)';
				ctx.fillRect(wx, wy, 2.2, 3.2);
			}
		}
	});

	// ---- crowd / stands ---------------------------------------------
	// roof/overhang shading above the crowd
	ctx.fillStyle = '#6b7482';
	ctx.fillRect(0, 148, STAGE_W, 8);
	const standsGrad = ctx.createLinearGradient(0, 156, 0, 246);
	standsGrad.addColorStop(0, '#7e8b9c');
	standsGrad.addColorStop(1, '#9aa6b5');
	ctx.fillStyle = standsGrad;
	ctx.fillRect(0, 156, STAGE_W, 90);
	// seated-crowd texture: small varied-colour dots in staggered rows
	const crowdPalette = ['#e8b98a', '#c98a5c', '#8a5a3c', '#274b8f', '#b1332b', '#2f7d4f', '#e8e8e8', '#3a3a3a', '#d9a441'];
	for (let row = 0; row < 8; row++) {
		const ry = 160 + row * 10.5;
		for (let col = 0; col < 78; col++) {
			const seed = row * 131 + col;
			const rx = col * 9 + (row % 2 === 0 ? 0 : 4.5) + pseudo(seed) * 2;
			if (rx > STAGE_W) continue;
			ctx.fillStyle = crowdPalette[Math.floor(pseudo(seed * 3.1) * crowdPalette.length)];
			ctx.beginPath();
			ctx.ellipse(rx, ry, 3.1, 3.6, 0, 0, Math.PI * 2);
			ctx.fill();
		}
	}
	// gentle shadow where the stands meet the field
	const standsShadow = ctx.createLinearGradient(0, 228, 0, 250);
	standsShadow.addColorStop(0, 'rgba(0,0,0,0)');
	standsShadow.addColorStop(1, 'rgba(0,0,0,0.25)');
	ctx.fillStyle = standsShadow;
	ctx.fillRect(0, 228, STAGE_W, 22);

	// ---- stadium light towers --------------------------------------
	function lightTower(cx) {
		const metal = ctx.createLinearGradient(cx - 14, 0, cx + 14, 0);
		metal.addColorStop(0, '#cbd3dc');
		metal.addColorStop(0.5, '#6b7684');
		metal.addColorStop(1, '#4a525e');
		ctx.strokeStyle = metal;
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.moveTo(cx - 13, 168); ctx.lineTo(cx, 46);
		ctx.moveTo(cx + 13, 168); ctx.lineTo(cx, 46);
		for (let yy = 163; yy > 52; yy -= 16) {
			const t = (yy - 46) / (168 - 46);
			ctx.moveTo(cx - 13 * t, yy); ctx.lineTo(cx + 13 * t, yy);
		}
		ctx.stroke();
		ctx.fillStyle = '#3d434e';
		ctx.fillRect(cx - 4, 168, 8, 10);
		// two lamp decks
		[36, 50].forEach((deckY, i) => {
			const w = i === 0 ? 46 : 38;
			ctx.fillStyle = '#3c4149';
			ctx.fillRect(cx - w / 2, deckY, w, 9);
			ctx.strokeStyle = '#20242a'; ctx.lineWidth = 1;
			ctx.strokeRect(cx - w / 2, deckY, w, 9);
			ctx.fillStyle = '#fff2c2';
			for (let lx = cx - w / 2 + 5; lx <= cx + w / 2 - 5; lx += 7) {
				ctx.beginPath(); ctx.arc(lx, deckY + 4.5, 2.4, 0, Math.PI * 2); ctx.fill();
			}
		});
		// aviation warning light on top
		ctx.fillStyle = '#e2413a';
		ctx.beginPath(); ctx.arc(cx, 33, 2, 0, Math.PI * 2); ctx.fill();
	}
	lightTower(46);
	lightTower(STAGE_W - 46);

	// ---- scoreboard (center view only; abstract shapes, no branding) ----
	if (dir === 'center') {
		const bbX = STAGE_W / 2 - 108, bbY = 78, bbW = 216, bbH = 68;
		ctx.fillStyle = '#0f151d';
		ctx.fillRect(bbX - 5, bbY - 5, bbW + 10, bbH + 10);
		const bez = ctx.createLinearGradient(0, bbY, 0, bbY + bbH);
		bez.addColorStop(0, '#333c48'); bez.addColorStop(1, '#171d24');
		ctx.fillStyle = bez;
		ctx.fillRect(bbX - 3, bbY - 3, bbW + 6, bbH + 6);

		const screen = ctx.createLinearGradient(0, bbY, 0, bbY + bbH);
		screen.addColorStop(0, '#123a52'); screen.addColorStop(1, '#0a1f2e');
		ctx.fillStyle = screen;
		ctx.fillRect(bbX, bbY, bbW, bbH);

		ctx.fillStyle = '#49c8ff'; ctx.fillRect(bbX + 8, bbY + 8, bbW - 16, 22);
		ctx.fillStyle = '#ff6a5e'; ctx.fillRect(bbX + 8, bbY + 34, 44, 26);
		ctx.fillStyle = '#f4f6f8'; ctx.fillRect(bbX + 56, bbY + 34, 44, 26);
		ctx.fillStyle = '#ffcf4d'; ctx.fillRect(bbX + 104, bbY + 8, bbW - 112, 52);
		// LED scanlines for a video-board texture
		ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1;
		for (let ly = bbY + 2; ly < bbY + bbH; ly += 3) { ctx.beginPath(); ctx.moveTo(bbX, ly); ctx.lineTo(bbX + bbW, ly); ctx.stroke(); }
		// flanking sponsor-panel shapes (abstract, no text)
		ctx.fillStyle = '#e7e9ec'; ctx.fillRect(bbX - 46, bbY + 12, 34, 44);
		ctx.fillStyle = '#e7e9ec'; ctx.fillRect(bbX + bbW + 12, bbY + 12, 34, 44);
	}

	// ---- grass -------------------------------------------------------
	const grass = ctx.createLinearGradient(0, 190, 0, STAGE_H);
	grass.addColorStop(0, '#417f37');
	grass.addColorStop(0.5, '#5a9e49');
	grass.addColorStop(1, '#7fc766');
	ctx.fillStyle = grass;
	ctx.beginPath();
	pathAlong((x) => fenceYAt(dir, x));
	ctx.lineTo(STAGE_W, STAGE_H); ctx.lineTo(0, STAGE_H);
	ctx.closePath();
	ctx.fill();

	// soft contact shadow the wall casts onto the grass/track
	const wallShadow = ctx.createLinearGradient(0, 0, 0, 34);
	wallShadow.addColorStop(0, 'rgba(0,0,0,0.28)');
	wallShadow.addColorStop(1, 'rgba(0,0,0,0)');
	ctx.save();
	ctx.beginPath();
	pathAlong((x) => fenceYAt(dir, x));
	ctx.lineTo(STAGE_W, STAGE_H); ctx.lineTo(0, STAGE_H);
	ctx.closePath();
	ctx.clip();
	ctx.translate(0, fenceYAt(dir, STAGE_W / 2));
	ctx.fillStyle = wallShadow;
	ctx.fillRect(0, -4, STAGE_W, 34);
	ctx.restore();

	// mowing stripes (trapezoids that widen toward the viewer for perspective)
	ctx.save();
	ctx.beginPath();
	pathAlong((x) => fenceYAt(dir, x));
	ctx.lineTo(STAGE_W, STAGE_H); ctx.lineTo(0, STAGE_H);
	ctx.closePath();
	ctx.clip();
	ctx.fillStyle = 'rgba(255,255,255,0.08)';
	const bands = 8;
	for (let i = 0; i < bands; i++) {
		if (i % 2 !== 0) continue;
		const topX0 = i * (STAGE_W / bands), topX1 = topX0 + STAGE_W / bands;
		const spread = 90;
		ctx.beginPath();
		ctx.moveTo(topX0, 150);
		ctx.lineTo(topX1, 150);
		ctx.lineTo(topX1 + spread, STAGE_H);
		ctx.lineTo(topX0 - spread, STAGE_H);
		ctx.closePath();
		ctx.fill();
	}
	ctx.restore();

	// ---- warning track (speckled dirt) -------------------------------
	const trackGrad = ctx.createLinearGradient(0, 0, 0, 20);
	trackGrad.addColorStop(0, '#b87c48');
	trackGrad.addColorStop(1, '#a8703f');
	ctx.save();
	ctx.beginPath();
	pathAlong((x) => fenceYAt(dir, x));
	for (let x = STAGE_W; x >= 0; x -= 10) ctx.lineTo(x, fenceYAt(dir, x) + 17);
	ctx.closePath();
	ctx.clip();
	ctx.translate(0, fenceYAt(dir, STAGE_W / 2));
	ctx.fillStyle = trackGrad;
	ctx.fillRect(0, -2, STAGE_W, 24);
	for (let i = 0; i < 260; i++) {
		const sx = pseudo(i * 7.3) * STAGE_W;
		const sy = pseudo(i * 3.1 + 4) * 18 - 1;
		ctx.fillStyle = pseudo(i) > 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.12)';
		ctx.fillRect(sx, sy, 1.6, 1.6);
	}
	ctx.restore();

	// ---- outfield wall: padding + ad boards + cap rail --------------
	// base padding (with vertical seam texture)
	ctx.save();
	ctx.beginPath();
	pathAlong((x) => wallTopAt(x) + boardH + capH);
	for (let x = STAGE_W; x >= 0; x -= 10) ctx.lineTo(x, fenceYAt(dir, x));
	ctx.closePath();
	ctx.clip();
	const padGrad = ctx.createLinearGradient(0, 0, 0, padH);
	padGrad.addColorStop(0, '#1d4a34');
	padGrad.addColorStop(1, '#123324');
	ctx.translate(0, 0);
	ctx.fillStyle = padGrad;
	ctx.fillRect(0, wallTopAt(0) + boardH + capH, STAGE_W, padH + 6);
	ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.2;
	for (let x = 8; x < STAGE_W; x += 16) {
		ctx.beginPath();
		ctx.moveTo(x, wallTopAt(x) + boardH + capH);
		ctx.lineTo(x, fenceYAt(dir, x));
		ctx.stroke();
	}
	ctx.restore();

	// ad-board panels (gradient-shaded, framed, generic colour blocks - no real ads)
	const panelColors = ['#1c5fa8', '#c8402f', '#218a52', '#d99a1f', '#2d5fa8', '#7a4fc7', '#c8402f', '#218a52'];
	const segW = STAGE_W / panelColors.length;
	panelColors.forEach((color, i) => {
		const x0 = i * segW, x1 = x0 + segW;
		ctx.save();
		ctx.beginPath();
		ctx.moveTo(x0, wallTopAt(x0));
		for (let x = x0; x <= x1; x += 8) ctx.lineTo(x, wallTopAt(x));
		for (let x = x1; x >= x0; x -= 8) ctx.lineTo(x, wallTopAt(x) + boardH);
		ctx.closePath();
		ctx.clip();
		const midY = wallTopAt((x0 + x1) / 2);
		const panelGrad = ctx.createLinearGradient(0, midY, 0, midY + boardH);
		panelGrad.addColorStop(0, shadeColor(color, 22));
		panelGrad.addColorStop(0.45, color);
		panelGrad.addColorStop(1, shadeColor(color, -28));
		ctx.fillStyle = panelGrad;
		ctx.fillRect(x0, midY - 2, segW + 1, boardH + 4);
		// top highlight + bottom shadow line for a raised-board look
		ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.4;
		ctx.beginPath(); ctx.moveTo(x0, wallTopAt(x0) + 1.5); ctx.lineTo(x1, wallTopAt(x1) + 1.5); ctx.stroke();
		ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1.4;
		ctx.beginPath(); ctx.moveTo(x0, wallTopAt(x0) + boardH - 1); ctx.lineTo(x1, wallTopAt(x1) + boardH - 1); ctx.stroke();
		ctx.restore();

		ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.6;
		ctx.beginPath(); ctx.moveTo(x0, wallTopAt(x0)); ctx.lineTo(x0, wallTopAt(x0) + boardH); ctx.stroke();
	});

	// cap rail (brushed-metal look) along the very top
	ctx.save();
	ctx.beginPath();
	pathAlong((x) => wallTopAt(x));
	for (let x = STAGE_W; x >= 0; x -= 10) ctx.lineTo(x, wallTopAt(x) + capH);
	ctx.closePath();
	const capGrad = ctx.createLinearGradient(0, 0, 0, capH);
	capGrad.addColorStop(0, '#e7ebef');
	capGrad.addColorStop(1, '#9aa4ad');
	ctx.fillStyle = capGrad;
	ctx.fill();
	ctx.restore();

	// yellow home-run line along the top edge of the wall
	ctx.strokeStyle = '#ffd400';
	ctx.lineWidth = 3;
	ctx.beginPath();
	pathAlong((x) => wallTopAt(x));
	ctx.stroke();

	// ---- foul poles (L / R views): pole, screen mesh, pennant --------
	if (dir === 'left' || dir === 'right') {
		const px = dir === 'left' ? 30 : STAGE_W - 30;
		const poleTop = 24, poleBottom = wallTopAt(px) + capH;
		const poleGrad = ctx.createLinearGradient(px - 3, 0, px + 3, 0);
		poleGrad.addColorStop(0, '#fff3a0');
		poleGrad.addColorStop(0.5, '#ffd400');
		poleGrad.addColorStop(1, '#c99e00');
		ctx.fillStyle = poleGrad;
		ctx.fillRect(px - 2.5, poleTop, 5, poleBottom - poleTop);
		// screen netting alongside the pole (common at real parks)
		ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
		const meshX = dir === 'left' ? px + 4 : px - 34;
		for (let gx = 0; gx <= 30; gx += 6) { ctx.beginPath(); ctx.moveTo(meshX + gx, poleTop + 10); ctx.lineTo(meshX + gx, poleBottom); ctx.stroke(); }
		for (let gy = poleTop + 10; gy <= poleBottom; gy += 8) { ctx.beginPath(); ctx.moveTo(meshX, gy); ctx.lineTo(meshX + 30, gy); ctx.stroke(); }
		// pennant flag near the top
		ctx.fillStyle = '#e2413a';
		ctx.beginPath();
		ctx.moveTo(px + 2.5, poleTop + 4);
		ctx.lineTo(px + 22, poleTop + 9);
		ctx.lineTo(px + 2.5, poleTop + 14);
		ctx.closePath();
		ctx.fill();
	}
}

// Lighten (positive amt) or darken (negative amt) a "#rrggbb" colour.
function shadeColor(hex, amt) {
	const n = parseInt(hex.slice(1), 16);
	let r = (n >> 16) + amt, g = ((n >> 8) & 0xff) + amt, b = (n & 0xff) + amt;
	r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
	return `rgb(${r},${g},${b})`;
}

/* ------------------------- simple vector sprites -------------------- */

// Shared chibi (2-头身 super-deformed) face: big eyes, blush, small smile.
// Drawn around a head centered at (0, headCy) with the given radius.
function drawCuteFace(headCy, r) {
	const ex = r * 0.34, ey = headCy + r * 0.02;

	ctx.fillStyle = '#fff';
	ctx.beginPath(); ctx.arc(-ex, ey, r * 0.26, 0, Math.PI * 2); ctx.fill();
	ctx.beginPath(); ctx.arc(ex, ey, r * 0.26, 0, Math.PI * 2); ctx.fill();

	ctx.fillStyle = '#2a2a2a';
	ctx.beginPath(); ctx.arc(-ex + 1, ey + 1.5, r * 0.13, 0, Math.PI * 2); ctx.fill();
	ctx.beginPath(); ctx.arc(ex + 1, ey + 1.5, r * 0.13, 0, Math.PI * 2); ctx.fill();

	ctx.fillStyle = 'rgba(255,130,130,0.55)';
	ctx.beginPath(); ctx.ellipse(-r * 0.62, headCy + r * 0.2, r * 0.2, r * 0.13, 0, 0, Math.PI * 2); ctx.fill();
	ctx.beginPath(); ctx.ellipse(r * 0.62, headCy + r * 0.2, r * 0.2, r * 0.13, 0, 0, Math.PI * 2); ctx.fill();

	ctx.strokeStyle = '#b33';
	ctx.lineWidth = 1.3;
	ctx.beginPath();
	ctx.arc(0, headCy + r * 0.38, r * 0.26, 0.15 * Math.PI, 0.85 * Math.PI);
	ctx.stroke();
}

// Chibi character anchored at its FEET (x,y). Draws upward from there.
function drawPitcherSprite(scene, x, y) {
	ctx.save();
	ctx.translate(x, y);

	const poses = [
		{ la: -25, ra: 195, spread: 0 },   // 0 set position
		{ la: -95, ra: 250, spread: -5 },  // 1 windup / leg lift
		{ la: 30, ra: 115, spread: 7 },    // 2 release
		{ la: 100, ra: 25, spread: 3 },    // 3 follow through
		{ la: -25, ra: 195, spread: 0 },   // 4 reset
	];
	const s = poses[Math.min(scene, poses.length - 1)];
	const jersey = '#3567c2', jerseyDark = '#28508f', skin = '#ffdcb2', capColor = '#dd4b39';

	ctx.lineCap = 'round';

	// legs
	ctx.strokeStyle = jerseyDark;
	ctx.lineWidth = 9;
	ctx.beginPath();
	ctx.moveTo(-5, -10); ctx.lineTo(-7 + s.spread, 0);
	ctx.moveTo(5, -10); ctx.lineTo(7 - s.spread, 0);
	ctx.stroke();

	// shoes
	ctx.fillStyle = '#3a3a3a';
	ctx.beginPath(); ctx.ellipse(-7 + s.spread, 1, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
	ctx.beginPath(); ctx.ellipse(7 - s.spread, 1, 5, 3, 0, 0, Math.PI * 2); ctx.fill();

	// torso (round & jellybean-shaped, not a stick)
	ctx.fillStyle = jersey;
	ctx.beginPath();
	ctx.ellipse(0, -22, 13, 13, 0, 0, Math.PI * 2);
	ctx.fill();

	// arms
	const laRad = s.la * Math.PI / 180, raRad = s.ra * Math.PI / 180;
	const lx = 14 * Math.cos(laRad), ly = -28 + 14 * Math.sin(laRad);
	const rx = 14 * Math.cos(raRad), ry = -28 + 14 * Math.sin(raRad);
	ctx.strokeStyle = jersey;
	ctx.lineWidth = 7;
	ctx.beginPath();
	ctx.moveTo(0, -28); ctx.lineTo(lx, ly);
	ctx.moveTo(0, -28); ctx.lineTo(rx, ry);
	ctx.stroke();
	ctx.fillStyle = skin;
	ctx.beginPath(); ctx.arc(lx, ly, 4.5, 0, Math.PI * 2); ctx.fill();
	ctx.beginPath(); ctx.arc(rx, ry, 4.5, 0, Math.PI * 2); ctx.fill();

	// head
	ctx.fillStyle = skin;
	ctx.beginPath();
	ctx.arc(0, -42, 15, 0, Math.PI * 2);
	ctx.fill();

	drawCuteFace(-42, 15);

	// cap
	ctx.fillStyle = capColor;
	ctx.beginPath();
	ctx.arc(0, -42, 15.5, Math.PI, Math.PI * 2);
	ctx.fill();
	ctx.beginPath();
	ctx.ellipse(0, -39, 11, 3.5, 0, 0, Math.PI * 2);
	ctx.fill();

	ctx.restore();
}

function drawBatterSprite(scene, x, y, boxSide) {
	ctx.save();
	ctx.translate(x, y);
	const mirror = boxSide === 2 ? -1 : 1;
	ctx.scale(mirror, 1);

	const poses = [
		{ bat: -70, arm: -35 },  // 0 ready stance
		{ bat: -115, arm: -60 }, // 1 load
		{ bat: 5, arm: 15 },     // 2 contact / swing through
		{ bat: 75, arm: 65 },    // 3 follow-through
	];
	const p = poses[Math.min(scene, poses.length - 1)];
	const jersey = '#e0483c', jerseyDark = '#b8362c', skin = '#ffdcb2', helmetColor = '#2748a3';

	ctx.lineCap = 'round';

	// legs
	ctx.strokeStyle = jerseyDark;
	ctx.lineWidth = 9;
	ctx.beginPath();
	ctx.moveTo(-5, -10); ctx.lineTo(-8, 0);
	ctx.moveTo(5, -10); ctx.lineTo(8, 0);
	ctx.stroke();
	ctx.fillStyle = '#3a3a3a';
	ctx.beginPath(); ctx.ellipse(-8, 1, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
	ctx.beginPath(); ctx.ellipse(8, 1, 5, 3, 0, 0, Math.PI * 2); ctx.fill();

	// torso
	ctx.fillStyle = jersey;
	ctx.beginPath();
	ctx.ellipse(0, -22, 13, 13, 0, 0, Math.PI * 2);
	ctx.fill();

	// arms + bat
	const armRad = p.arm * Math.PI / 180;
	const handX = 14 * Math.cos(armRad), handY = -28 + 14 * Math.sin(armRad);
	ctx.strokeStyle = jersey;
	ctx.lineWidth = 7;
	ctx.beginPath();
	ctx.moveTo(0, -28); ctx.lineTo(handX, handY);
	ctx.stroke();
	ctx.fillStyle = skin;
	ctx.beginPath(); ctx.arc(handX, handY, 4.5, 0, Math.PI * 2); ctx.fill();

	const batRad = p.bat * Math.PI / 180;
	ctx.strokeStyle = '#a9702f';
	ctx.lineWidth = 5;
	ctx.lineCap = 'round';
	ctx.beginPath();
	ctx.moveTo(handX, handY);
	ctx.lineTo(handX + 26 * Math.cos(batRad), handY + 26 * Math.sin(batRad));
	ctx.stroke();

	// head
	ctx.fillStyle = skin;
	ctx.beginPath();
	ctx.arc(0, -42, 15, 0, Math.PI * 2);
	ctx.fill();

	drawCuteFace(-42, 15);

	// batting helmet (with an ear-flap for a cuter, rounder silhouette)
	ctx.fillStyle = helmetColor;
	ctx.beginPath();
	ctx.arc(0, -42, 15.5, Math.PI, Math.PI * 2);
	ctx.fill();
	ctx.beginPath();
	ctx.ellipse(0, -39, 11, 3.5, 0, 0, Math.PI * 2);
	ctx.fill();
	ctx.beginPath();
	ctx.ellipse(-13, -37, 4, 6, 0, 0, Math.PI * 2);
	ctx.fill();

	ctx.restore();
}

function drawBallIcon(x, y, r) {
	ctx.beginPath();
	ctx.fillStyle = '#fff';
	ctx.arc(x, y, r, 0, Math.PI * 2);
	ctx.fill();
	ctx.strokeStyle = '#c0392b';
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.arc(x, y, r * 0.6, 0.4, 2.2);
	ctx.stroke();
	ctx.strokeStyle = 'rgba(0,0,0,0.25)';
	ctx.lineWidth = 0.7;
	ctx.beginPath();
	ctx.arc(x, y, r, 0, Math.PI * 2);
	ctx.stroke();
}

function drawMascotIcon(x, y, r) {
	// simple original star-mascot icon (not affiliated with any team)
	ctx.save();
	ctx.translate(x, y);
	ctx.fillStyle = '#ffb400';
	ctx.beginPath();
	for (let i = 0; i < 5; i++) {
		const a = -Math.PI / 2 + i * (2 * Math.PI / 5);
		const a2 = a + Math.PI / 5;
		ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
		ctx.lineTo(Math.cos(a2) * r * 0.45, Math.sin(a2) * r * 0.45);
	}
	ctx.closePath();
	ctx.fill();
	ctx.restore();
}

/* ------------------------------ HUD --------------------------------- */

function drawHUD() {
	if (!batter.show) return;

	ctx.fillStyle = 'rgba(20,20,20,0.75)';
	ctx.font = "bold 16px sans-serif";
	ctx.fillText(`残り ${Number(MAX_BALL_COUNT - ballCount + 1)}球`, 14, 22);

	for (let i = 0; i <= MAX_BALL_COUNT - ballCount; i++) {
		const yy = (i % 2 === 0) ? 34 : 46;
		drawBallIcon(20 + i * 15, yy, 6);
	}

	ctx.fillStyle = 'rgba(20,20,20,0.75)';
	ctx.textAlign = 'right';
	ctx.fillText(`ホームラン ${Number(homerunCount)}本`, STAGE_W - 14, 22);
	ctx.textAlign = 'left';

	for (let i = 0; i < homerunCount; i++) {
		const yy = (i % 2 === 0) ? 34 : 46;
		drawMascotIcon(STAGE_W - 20 - i * 15, yy, 7);
	}
}

/* --------------------- home run celebration -------------------------- */

function drawHomerunCelebration() {
	if (soundFirst) soundFirst = false;

	if (centerLineHeight < maxCenterLineHeight) {
		centerLineHeight += 30;
		if (centerLineHeight > maxCenterLineHeight) centerLineHeight = maxCenterLineHeight;
	}

	ctx.fillStyle = 'rgba(238,238,238,0.5)';
	const lineX = STAGE_W / 2 - centerLineWidth / 2;
	const lineY = STAGE_H / 2 - centerLineHeight / 2;
	ctx.fillRect(lineX, lineY, centerLineWidth, centerLineHeight);

	if (centerLineHeight < maxCenterLineHeight) return;

	ctx.fillStyle = 'rgba(228,228,228,0.85)';
	if (centerLineWidth2 < centerLineWidth - 20) {
		centerLineWidth2 += 50;
		if (centerLineWidth2 > centerLineWidth - 20) centerLineWidth2 = centerLineWidth - 20;
	}
	const lineX2 = STAGE_W / 2 - centerLineWidth2 / 2;
	const lineY2 = STAGE_H / 2 - centerLineHeight2 / 2;
	ctx.fillRect(lineX2, lineY2, centerLineWidth2, centerLineHeight2);

	if (centerLineWidth2 < centerLineWidth - 20) return;

	const maxScale = 1.0;
	let finishedGrowing;
	if (!perfectFlg) {
		if (homerunTextScale <= maxScale) homerunTextScale += 0.045;
		drawZoomText('HOME RUN!', STAGE_W / 2, STAGE_H / 2 - 18, Math.min(homerunTextScale, maxScale), '#e63946');
		finishedGrowing = homerunTextScale >= maxScale;
	} else {
		if (perfectTextScale <= maxScale) perfectTextScale += 0.045;
		drawZoomText('PERFECT!!', STAGE_W / 2, STAGE_H / 2 - 18, Math.min(perfectTextScale, maxScale), '#ffb400');
		finishedGrowing = true;
	}

	if (finishedGrowing) {
		ctx.save();
		ctx.font = "bold 22px sans-serif";
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillStyle = '#233';
		ctx.fillText(`推定飛距離 ${lastHomerunDistance} m`, STAGE_W / 2, STAGE_H / 2 + 36);
		ctx.restore();
	}

	if (finishedGrowing || perfectFlg) {
		waitCount++;
		if (waitCount > HOMERUN_WAIT) {
			if (homerunCount === MAX_BALL_COUNT) {
				perfectFlg = true;
				if (waitCount < HOMERUN_WAIT + PERFECT_EXTRA_WAIT) return;
			}
			soundFirst = true;
			homerunFlg = false;
			nextBall();
		}
	}
}

function drawZoomText(text, cx, cy, scale, color) {
	if (scale <= 0) return;
	ctx.save();
	ctx.translate(cx, cy);
	ctx.scale(scale, scale);
	ctx.font = "bold 54px sans-serif";
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.lineWidth = 8;
	ctx.strokeStyle = 'rgba(0,0,0,0.55)';
	ctx.strokeText(text, 0, 0);
	ctx.fillStyle = color;
	ctx.fillText(text, 0, 0);
	ctx.restore();
}

/* -------------------------- input handling ---------------------------- */

function getCanvasX(clientX) {
	const rect = canvas.getBoundingClientRect();
	return (clientX - rect.left) * (STAGE_W / rect.width);
}

canvas.addEventListener('pointerdown', (e) => {
	pointerDown = true;
	initialMouseX = getCanvasX(e.clientX);
	nowMouseX = initialMouseX;
	e.preventDefault();
});

canvas.addEventListener('pointermove', (e) => {
	if (pointerDown) nowMouseX = getCanvasX(e.clientX);
});

window.addEventListener('pointerup', (e) => {
	if (!pointerDown) return;
	pointerDown = false;
	startSwing();
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

btnStart.addEventListener('click', (e) => { e.stopPropagation(); startGame(); });
btnStart.addEventListener('pointerdown', (e) => e.stopPropagation());

btnBoxChange.addEventListener('click', (e) => { e.stopPropagation(); boxChange(); });
btnBoxChange.addEventListener('pointerdown', (e) => e.stopPropagation());

/* ------------------------------- boot ---------------------------------- */

function drawScene() {
	ctx.clearRect(0, 0, STAGE_W, STAGE_H);
	drawBackground();
	batter.dispMe();
	pitcher.dispMe();
	drawHUD();
}

initGame();

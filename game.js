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
const MAX_BALL_COUNT = 10;
const LASTPOS = 430;      // y where a pitch reaches the catcher's mitt
const PITCH_START_Y = 228; // y where the ball leaves the pitcher's hand (matches the mound position)
const CURVE_START_Y = 120;// y after which curve/shoot pitches start bending
const BAT_CONTACT_Y = 300;
const HOMERUN_WAIT = 40;
const PERFECT_EXTRA_WAIT = 100;

const canvas = document.getElementById('field');
const ctx = canvas.getContext('2d');
const btnStart = document.getElementById('btnStart');
const btnBoxChange = document.getElementById('btnBoxChange');

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

const batterPosX = 310, batterPosY = 160;

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
	x: 350, y: 230, timeCnt: 0, indexNo: -1, sceneNo: 0, show: true,
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
				ball.initMe(350, PITCH_START_Y);
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
			drawBatterSprite(this.sceneNo, renderX, this.y + 190, box);
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
						else { nextBall(); return; }
					}
				} else if (Dir === "R2") {
					if (shade.x <= 436 && shade.y <= 260) {
						if (realZ > wallHeight) wallPlus = 68;
						else { nextBall(); return; }
					}
				} else {
					const cx = 350, cy = 1036, cr = 2100;
					const yy = cy - Math.sqrt(Math.pow(cr, 2) - Math.pow(shade.x - cx, 2)) + 1260;
					if (shade.y < yy) {
						if (realZ > wallHeight + 66) wallPlus = 70;
						else { nextBall(); return; }
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
						soundHomerun();
						return;
					}
					nextBall();
					return;
				}
			}
		}

		if (this.show && this.y >= LASTPOS) {
			gammingFlg = false;
			this.show = false;
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
	// sky
	const sky = ctx.createLinearGradient(0, 0, 0, 90);
	sky.addColorStop(0, '#bfe3ff');
	sky.addColorStop(1, '#e9f7ff');
	ctx.fillStyle = sky;
	ctx.fillRect(0, 0, STAGE_W, 90);

	// distant fence + outfield grass
	ctx.fillStyle = '#5a9a4a';
	ctx.beginPath();
	ctx.moveTo(0, 90);
	ctx.quadraticCurveTo(STAGE_W / 2, 70, STAGE_W, 90);
	ctx.lineTo(STAGE_W, STAGE_H);
	ctx.lineTo(0, STAGE_H);
	ctx.closePath();
	ctx.fill();

	// mowing stripes
	ctx.fillStyle = 'rgba(255,255,255,0.06)';
	for (let i = 0; i < 6; i++) {
		ctx.beginPath();
		const topX0 = i * (STAGE_W / 6), topX1 = topX0 + STAGE_W / 12;
		const spread = 60;
		ctx.moveTo(topX0, 95);
		ctx.lineTo(topX1, 95);
		ctx.lineTo(topX1 + spread, STAGE_H);
		ctx.lineTo(topX0 - spread, STAGE_H);
		ctx.closePath();
		if (i % 2 === 0) ctx.fill();
	}

	// outfield wall
	ctx.strokeStyle = '#2f4f2f';
	ctx.lineWidth = 10;
	ctx.beginPath();
	ctx.moveTo(0, 92);
	ctx.quadraticCurveTo(STAGE_W / 2, 72, STAGE_W, 92);
	ctx.stroke();

	// foul lines
	ctx.strokeStyle = '#fff';
	ctx.lineWidth = 3;
	ctx.beginPath();
	ctx.moveTo(base_center(), 392);
	ctx.lineTo(30, 96);
	ctx.moveTo(base_center(), 392);
	ctx.lineTo(670, 96);
	ctx.stroke();

	// infield dirt
	ctx.fillStyle = '#c68a52';
	ctx.beginPath();
	ctx.moveTo(base_center(), 392);
	ctx.lineTo(base_center() - 150, 250);
	ctx.lineTo(base_center(), 140);
	ctx.lineTo(base_center() + 150, 250);
	ctx.closePath();
	ctx.fill();

	// infield grass diamond
	ctx.fillStyle = '#6bb356';
	ctx.beginPath();
	ctx.moveTo(base_center(), 360);
	ctx.lineTo(base_center() - 95, 250);
	ctx.lineTo(base_center(), 175);
	ctx.lineTo(base_center() + 95, 250);
	ctx.closePath();
	ctx.fill();

	// pitcher's mound (sits inside the infield diamond, between home plate and the outfield)
	ctx.fillStyle = '#c68a52';
	ctx.beginPath();
	ctx.ellipse(350, 270, 30, 14, 0, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = '#e8d3b0';
	ctx.fillRect(345, 266, 10, 4);

	// batter boxes
	ctx.strokeStyle = 'rgba(255,255,255,0.85)';
	ctx.lineWidth = 2;
	ctx.strokeRect(base_center() - 55, 355, 34, 46);
	ctx.strokeRect(base_center() + 21, 355, 34, 46);

	// home plate
	ctx.fillStyle = '#fff';
	ctx.beginPath();
	ctx.moveTo(base_center() - 12, 392);
	ctx.lineTo(base_center() + 12, 392);
	ctx.lineTo(base_center() + 12, 400);
	ctx.lineTo(base_center(), 408);
	ctx.lineTo(base_center() - 12, 400);
	ctx.closePath();
	ctx.fill();
}

function base_center() { return 350; }

function drawOutfieldBG(dir) {
	// sky
	const sky = ctx.createLinearGradient(0, 0, 0, 150);
	sky.addColorStop(0, '#a9d8ff');
	sky.addColorStop(1, '#eef9ff');
	ctx.fillStyle = sky;
	ctx.fillRect(0, 0, STAGE_W, 150);

	// grass, perspective shading
	const grass = ctx.createLinearGradient(0, 150, 0, STAGE_H);
	grass.addColorStop(0, '#4f8f42');
	grass.addColorStop(1, '#79c264');
	ctx.fillStyle = grass;
	ctx.fillRect(0, 150, STAGE_W, STAGE_H - 150);

	// stripes converging based on direction
	ctx.fillStyle = 'rgba(255,255,255,0.07)';
	const bias = dir === 'left' ? -60 : (dir === 'right' ? 60 : 0);
	for (let i = 0; i < 7; i++) {
		ctx.beginPath();
		const topX0 = i * (STAGE_W / 7) + bias * 0.15, topX1 = topX0 + STAGE_W / 14;
		ctx.moveTo(topX0, 152);
		ctx.lineTo(topX1, 152);
		ctx.lineTo(topX1 + 100, STAGE_H);
		ctx.lineTo(topX0 - 100, STAGE_H);
		ctx.closePath();
		if (i % 2 === 0) ctx.fill();
	}

	// crowd / stands strip
	ctx.fillStyle = '#8892a3';
	ctx.fillRect(0, 118, STAGE_W, 22);
	ctx.fillStyle = 'rgba(0,0,0,0.12)';
	for (let i = 0; i < 40; i++) {
		ctx.fillRect(i * 18 + (i % 2), 120, 6, 18);
	}

	// outfield wall
	ctx.fillStyle = '#2f6b4f';
	ctx.fillRect(0, 140, STAGE_W, 14);
	ctx.strokeStyle = '#1c4a34';
	ctx.lineWidth = 2;
	ctx.strokeRect(0, 140, STAGE_W, 14);

	// foul pole accent for L / R views
	if (dir === 'left') {
		ctx.fillStyle = '#ffde3d';
		ctx.fillRect(30, 20, 6, 130);
	} else if (dir === 'right') {
		ctx.fillStyle = '#ffde3d';
		ctx.fillRect(STAGE_W - 36, 20, 6, 130);
	}
}

/* ------------------------- simple vector sprites -------------------- */

function drawPitcherSprite(scene, x, y) {
	ctx.save();
	ctx.translate(x, y);
	const armSets = [
		{ la: -20, ra: 200, leg: 0 },   // 0 set position
		{ la: -70, ra: 260, leg: -14 }, // 1 windup / leg lift
		{ la: 40, ra: 130, leg: 14 },   // 2 release
		{ la: 90, ra: 40, leg: 6 },     // 3 follow through
		{ la: -20, ra: 200, leg: 0 },   // 4 reset
	];
	const s = armSets[Math.min(scene, armSets.length - 1)];

	ctx.strokeStyle = '#1a3d7c';
	ctx.fillStyle = '#1a3d7c';
	ctx.lineWidth = 4;
	ctx.lineCap = 'round';

	// legs
	ctx.beginPath();
	ctx.moveTo(0, 24); ctx.lineTo(-8 + s.leg, 40);
	ctx.moveTo(0, 24); ctx.lineTo(8 - s.leg, 40);
	ctx.stroke();

	// torso
	ctx.beginPath();
	ctx.moveTo(0, 0); ctx.lineTo(0, 24);
	ctx.stroke();

	// arms (angle in degrees from torso top)
	const laRad = s.la * Math.PI / 180, raRad = s.ra * Math.PI / 180;
	ctx.beginPath();
	ctx.moveTo(0, 4);
	ctx.lineTo(18 * Math.cos(laRad), 4 + 18 * Math.sin(laRad));
	ctx.moveTo(0, 4);
	ctx.lineTo(18 * Math.cos(raRad), 4 + 18 * Math.sin(raRad));
	ctx.stroke();

	// head
	ctx.beginPath();
	ctx.arc(0, -8, 8, 0, Math.PI * 2);
	ctx.fill();
	// cap
	ctx.fillStyle = '#c0392b';
	ctx.beginPath();
	ctx.arc(0, -8, 8, Math.PI, Math.PI * 2);
	ctx.fill();

	ctx.restore();
}

function drawBatterSprite(scene, x, y, boxSide) {
	ctx.save();
	ctx.translate(x + 20, y + 40);
	const mirror = boxSide === 2 ? -1 : 1;
	ctx.scale(mirror, 1);

	const poses = [
		{ bat: -60, arm: -40 }, // 0 ready stance
		{ bat: -100, arm: -70 }, // 1 load
		{ bat: 10, arm: 10 },    // 2 contact / swing through
		{ bat: 70, arm: 60 },    // 3 follow-through
	];
	const p = poses[Math.min(scene, poses.length - 1)];

	ctx.strokeStyle = '#c0392b';
	ctx.fillStyle = '#c0392b';
	ctx.lineWidth = 4;
	ctx.lineCap = 'round';

	// legs
	ctx.beginPath();
	ctx.moveTo(0, 20); ctx.lineTo(-9, 40);
	ctx.moveTo(0, 20); ctx.lineTo(9, 40);
	ctx.stroke();

	// torso
	ctx.beginPath();
	ctx.moveTo(0, -6); ctx.lineTo(0, 20);
	ctx.stroke();

	// arms + bat
	const armRad = p.arm * Math.PI / 180;
	const handX = 16 * Math.cos(armRad), handY = -2 + 16 * Math.sin(armRad);
	ctx.beginPath();
	ctx.moveTo(0, -2);
	ctx.lineTo(handX, handY);
	ctx.stroke();

	const batRad = p.bat * Math.PI / 180;
	ctx.strokeStyle = '#8a5a2b';
	ctx.lineWidth = 5;
	ctx.beginPath();
	ctx.moveTo(handX, handY);
	ctx.lineTo(handX + 26 * Math.cos(batRad), handY + 26 * Math.sin(batRad));
	ctx.stroke();

	// head + helmet
	ctx.fillStyle = '#f2c48b';
	ctx.beginPath();
	ctx.arc(0, -14, 8, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = '#1a3d7c';
	ctx.beginPath();
	ctx.arc(0, -14, 8, Math.PI, Math.PI * 2);
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
		drawZoomText('HOME RUN!', STAGE_W / 2, STAGE_H / 2, Math.min(homerunTextScale, maxScale), '#e63946');
		finishedGrowing = homerunTextScale >= maxScale;
	} else {
		if (perfectTextScale <= maxScale) perfectTextScale += 0.045;
		drawZoomText('PERFECT!!', STAGE_W / 2, STAGE_H / 2, Math.min(perfectTextScale, maxScale), '#ffb400');
		finishedGrowing = true;
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

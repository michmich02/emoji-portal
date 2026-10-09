// ============================================================
// AR Gesture Canvas — Main Application
// ============================================================

// --- Configuration ---
const CFG = {
  lerpSpeed: 0.25,
  particleCount: 50,
};

// --- DOM ---
const video       = document.getElementById('webcam');
const canvas      = document.getElementById('arCanvas');
const ctx         = canvas.getContext('2d');
const loadingEl   = document.getElementById('loading-overlay');
const statusDot   = document.getElementById('status-dot');
const statusText  = document.getElementById('status-text');

// Offscreen canvas for advanced processing
const offCanvas = document.createElement('canvas');
const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
const btnLandmarks= document.getElementById('btn-landmarks');
const btnReset    = document.getElementById('btn-reset');

// Style panel DOM
const stylePanel = document.getElementById('style-panel');
const togglePanelBtn = document.getElementById('toggle-panel');
const togglePanelExtBtn = document.getElementById('toggle-panel-btn');
const styleItems = document.querySelectorAll('.style-item');

// Hide the upload button as we use live anime face now
const btnUpload = document.getElementById('btn-upload');
if(btnUpload) btnUpload.style.display = 'none';

// --- State ---
let showLandmarks = false;
let handsData = null;

let quad = {
  tl: {x:0, y:0, vx:0, vy:0},
  tr: {x:0, y:0, vx:0, vy:0},
  br: {x:0, y:0, vx:0, vy:0},
  bl: {x:0, y:0, vx:0, vy:0}
};
let targetQuad = {
  tl: {x:0, y:0},
  tr: {x:0, y:0},
  br: {x:0, y:0},
  bl: {x:0, y:0}
};
let isCanvasActive = false;
let canvasAlpha = 0; // For fade in/out

let particles = [];
let styleTransitionT = 0; // 1.0 to 0.0 for crossfade flash
let membraneState = 'idle'; // 'idle', 'active', 'shattering'
let pinchFrames = 0; // Debounce for deliberate pinching

let ripples = [];
let prevTips = {};

// --- Ring Buffer for Time Delay ---
const FRAME_DELAY = 12; // 0.2s at 60fps
const frameBuffer = [];
let currentBufferIdx = 0;

// Initialize frame buffers (640x360 to save memory)
for (let i = 0; i < FRAME_DELAY; i++) {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 360;
  frameBuffer.push({ canvas: c, ctx: c.getContext('2d', {willReadFrequently: true}) });
}

// --- Utilities ---
const lerp  = (a, b, t) => a + (b - a) * t;
function lerpPt(a, b, t) { return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }; }
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function pointInQuad(p, q) {
  const cross = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const c1 = cross(q.tl, q.tr, p);
  const c2 = cross(q.tr, q.br, p);
  const c3 = cross(q.br, q.bl, p);
  const c4 = cross(q.bl, q.tl, p);
  return (c1 >= 0 && c2 >= 0 && c3 >= 0 && c4 >= 0) || 
         (c1 <= 0 && c2 <= 0 && c3 <= 0 && c4 <= 0);
}

function resize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

function initParticles() {
  particles = [];
  for (let i = 0; i < CFG.particleCount; i++) {
    particles.push({
      t: Math.random(), // position along perimeter 0-1
      speed: 0.001 + Math.random() * 0.002,
      size: 1 + Math.random() * 2.5,
      alpha: 0.3 + Math.random() * 0.5,
      offset: (Math.random() - 0.5) * 15,
    });
  }
}
initParticles();

// --- Coordinate mapping ---
function landmarkPx(lm) {
  return {
    x: (1 - lm.x) * canvas.width,
    y: lm.y * canvas.height
  };
}

function setStatus(status) {
  statusDot.className = status;
  statusText.textContent = status.charAt(0).toUpperCase() + status.slice(1);
}

// ============================================================
// MediaPipe Setup
// ============================================================

let handsLoaded = false;

function checkLoaded() {
  if (handsLoaded) {
    loadingEl.classList.add('hidden');
  }
}

const hands = new Hands({
  locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
});
hands.setOptions({
  maxNumHands: 2,
  modelComplexity: 1,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.5,
});
hands.onResults(results => {
  handsData = results;
  handsLoaded = true;
  checkLoaded();
});



async function startCamera() {
  try {
    // Show status update
    loadingEl.querySelector('p').textContent = "Initializing models (may take a moment)...";
    
    await hands.initialize();
    
    loadingEl.querySelector('p').textContent = "Starting camera...";

    const cam = new Camera(video, {
      onFrame: async () => {
        try {
          await hands.send({ image: video });
        } catch (err) {
          console.error("Frame processing error:", err);
        }
      },
      width: 1280,
      height: 720,
    });
    
    await cam.start();
  } catch (err) {
    console.error("Initialization error:", err);
    loadingEl.innerHTML = `<p style="color:#ff6bb5; padding: 20px; text-align: center;">Error loading models or camera.<br><span style="font-size:12px; color:#aaa;">${err.message || err}</span></p>`;
  }
}
startCamera();

// ============================================================
// Drawing helpers
// ============================================================

function drawVideoMirrored() {
  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function drawHandLandmarks(multiLandmarks) {
  if (!showLandmarks || !multiLandmarks) return;
  const connections = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [5,9],[9,10],[10,11],[11,12],
    [9,13],[13,14],[14,15],[15,16],
    [13,17],[17,18],[18,19],[19,20],[0,17]
  ];
  for (const lms of multiLandmarks) {
    ctx.strokeStyle = 'rgba(0,212,255,0.35)';
    ctx.lineWidth = 1.5;
    for (const [a, b] of connections) {
      const pa = landmarkPx(lms[a]);
      const pb = landmarkPx(lms[b]);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    }
    for (let i = 0; i < lms.length; i++) {
      const p = landmarkPx(lms[i]);
      // Highlight thumb (4) and index (8) tips
      const isTip = (i === 4 || i === 8);
      const r = isTip ? 6 : 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = isTip ? 'rgba(255,107,181,0.9)' : 'rgba(255,255,255,0.6)';
      if (isTip) {
        ctx.shadowColor = '#ff6bb5';
        ctx.shadowBlur = 10;
      } else {
        ctx.shadowBlur = 0;
      }
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }
}


function getPerimeterPoint(corners, t) {
  const segs = [
    [corners.tl, corners.tr],
    [corners.tr, corners.br],
    [corners.br, corners.bl],
    [corners.bl, corners.tl]
  ];
  const seg = Math.min(3, Math.floor(t * 4));
  const lt = (t * 4) - seg;
  const [p1, p2] = segs[seg];
  return { x: lerp(p1.x, p2.x, lt), y: lerp(p1.y, p2.y, lt) };
}

function drawARCanvas(corners, alpha, targetCtx = ctx, isPinning = false) {
  const c = targetCtx;
  const {tl, tr, br, bl} = corners;
  const cx = (tl.x + tr.x + br.x + bl.x) / 4;
  const cy = (tl.y + tr.y + br.y + bl.y) / 4;

  // Calculate Area & Intensity
  const area = 0.5 * Math.abs((tl.x * tr.y + tr.x * br.y + br.x * bl.y + bl.x * tl.y) - 
                              (tr.x * tl.y + br.x * tr.y + bl.x * br.y + tl.x * bl.y));
  const maxArea = canvas.width * canvas.height * 0.4;
  const stretchIntensity = Math.min(1.0, area / maxArea);
  
  // Fetch delayed frame
  const delayedBuf = frameBuffer[currentBufferIdx].canvas;

  // Helper to draw elastic bowed edges
  const drawElasticQuad = (c) => {
    const bow = 0.15 * stretchIntensity; 
    const bowPt = (p1, p2) => ({
      x: (p1.x + p2.x)/2 + (cx - (p1.x + p2.x)/2) * bow,
      y: (p1.y + p2.y)/2 + (cy - (p1.y + p2.y)/2) * bow
    });
    c.beginPath();
    c.moveTo(tl.x, tl.y);
    const topMid = bowPt(tl, tr); c.quadraticCurveTo(topMid.x, topMid.y, tr.x, tr.y);
    const rightMid = bowPt(tr, br); c.quadraticCurveTo(rightMid.x, rightMid.y, br.x, br.y);
    const botMid = bowPt(br, bl); c.quadraticCurveTo(botMid.x, botMid.y, bl.x, bl.y);
    const leftMid = bowPt(bl, tl); c.quadraticCurveTo(leftMid.x, leftMid.y, tl.x, tl.y);
    c.closePath();
  };

  // Outer bloom (Layer 1)
  c.save();
  c.globalAlpha = alpha;
  c.shadowColor = 'rgba(180,77,255,0.6)';
  c.shadowBlur = 30 + 20 * stretchIntensity;
  drawElasticQuad(c);
  c.strokeStyle = 'rgba(180,77,255,0.2)';
  c.lineWidth = 10;
  c.stroke();
  c.restore();

  // 3D Bevel/Thickness (Layer 2)
  c.save();
  c.globalAlpha = alpha * 0.7;
  c.translate(4, 8); 
  drawElasticQuad(c);
  c.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  c.lineWidth = 15;
  c.filter = 'blur(4px)';
  c.stroke();
  c.restore();

  // Draw Stylized Video inside the quad
  c.save();
  c.globalAlpha = alpha;
  
  drawElasticQuad(c);
  c.clip();
  
  // Apply 3D Parallax and Sag Distortion
  const dx = (cx - canvas.width / 2) / (canvas.width / 2);
  const dy = (cy - canvas.height / 2) / (canvas.height / 2);
  const parallaxDepth = 40 + 80 * stretchIntensity;
  
  c.translate(dx * parallaxDepth, dy * parallaxDepth);
  
  const zoom = 1.05 + 0.1 * stretchIntensity;
  c.translate(canvas.width/2, canvas.height/2);
  c.scale(zoom, zoom);
  c.translate(-canvas.width/2, -canvas.height/2);
  
  const style = window.currentFaceStyle || 'ascii';

  if (style === 'ink') {
    c.filter = `grayscale(1) contrast(${1.2 + 0.6*stretchIntensity}) brightness(1.2) sepia(0.1)`;
    c.drawImage(delayedBuf, 0, 0, canvas.width, canvas.height);
    c.filter = 'none';
    
    // Reset to draw overlay
    c.globalCompositeOperation = 'multiply';
    c.fillStyle = `rgba(230, 225, 215, ${0.2 + 0.4*stretchIntensity})`;
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.globalCompositeOperation = 'source-over';
  } 
  else if (style === 'mosaic') {
    const pSize = Math.max(4, Math.floor(24 * stretchIntensity));
    offCanvas.width = Math.ceil(canvas.width / pSize);
    offCanvas.height = Math.ceil(canvas.height / pSize);
    
    // delayedBuf is already mirrored from the ring buffer capture
    offCtx.drawImage(delayedBuf, 0, 0, offCanvas.width, offCanvas.height);
    
    c.imageSmoothingEnabled = false;
    c.drawImage(offCanvas, 0, 0, canvas.width, canvas.height);
    c.imageSmoothingEnabled = true;
  }
  else if (style === 'ascii') {
    const pSize = Math.max(6, Math.floor(14 * stretchIntensity));
    const w = Math.ceil(canvas.width / pSize);
    const h = Math.ceil(canvas.height / pSize);
    offCanvas.width = w;
    offCanvas.height = h;
    
    // delayedBuf is already mirrored
    offCtx.drawImage(delayedBuf, 0, 0, w, h);
    
    const imgData = offCtx.getImageData(0, 0, w, h).data;
    const chars = ['@', '#', 'S', '%', '?', '*', '+', ';', ':', ',', '.'];
    
    // Black background
    c.fillStyle = '#0a0a0a';
    c.fillRect(0, 0, canvas.width, canvas.height);
    
    c.font = 'bold 10px monospace';
    c.fillStyle = '#00ff41'; // Hacker green
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    
    // To optimize, only draw within the bounding box of the quad
    const minX = Math.floor(Math.min(tl.x, tr.x, bl.x, br.x) / pSize);
    const maxX = Math.ceil(Math.max(tl.x, tr.x, bl.x, br.x) / pSize);
    const minY = Math.floor(Math.min(tl.y, tr.y, bl.y, br.y) / pSize);
    const maxY = Math.ceil(Math.max(tl.y, tr.y, bl.y, br.y) / pSize);
    
    for (let y = Math.max(0, minY); y < Math.min(h, maxY); y++) {
      for (let x = Math.max(0, minX); x < Math.min(w, maxX); x++) {
        const i = (y * w + x) * 4;
        const r = imgData[i];
        const g = imgData[i+1];
        const b = imgData[i+2];
        const brightness = (r + g + b) / 3;
        const charIdx = Math.floor((brightness / 255) * (chars.length - 1));
        c.fillText(chars[charIdx], x * pSize + pSize/2, y * pSize + pSize/2);
      }
    }
  }
  else if (style === 'glitch') {
    const shift = 10 * stretchIntensity;
    c.globalCompositeOperation = 'source-over';
    c.drawImage(delayedBuf, 0, 0, canvas.width, canvas.height);
    
    // Draw horizontal slices
    for(let i=0; i<3; i++) {
        const sy = Math.random() * canvas.height;
        const sh = Math.random() * 30 + 5;
        const dx = (Math.random() - 0.5) * 50 * stretchIntensity;
        c.drawImage(delayedBuf, 0, sy, canvas.width, sh, dx, sy, canvas.width, sh);
    }
    
    // Chromatic aberration via screen blending
    c.globalCompositeOperation = 'screen';
    c.fillStyle = 'rgba(255,0,0,0.5)'; c.fillRect(0,0, canvas.width, canvas.height);
    c.globalCompositeOperation = 'multiply';
    c.drawImage(delayedBuf, shift, 0, canvas.width, canvas.height);
    
    c.globalCompositeOperation = 'screen';
    c.fillStyle = 'rgba(0,255,255,0.5)'; c.fillRect(0,0, canvas.width, canvas.height);
    c.globalCompositeOperation = 'multiply';
    c.drawImage(delayedBuf, -shift, 0, canvas.width, canvas.height);
    c.globalCompositeOperation = 'source-over';
  }
  else if (style === 'halftone') {
    const pSize = Math.max(6, Math.floor(16 * stretchIntensity));
    const w = Math.ceil(canvas.width / pSize);
    const h = Math.ceil(canvas.height / pSize);
    offCanvas.width = w; offCanvas.height = h;
    offCtx.drawImage(delayedBuf, 0, 0, w, h);
    const imgData = offCtx.getImageData(0, 0, w, h).data;
    
    c.fillStyle = '#f0f0f0';
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.fillStyle = '#111';
    
    const minX = Math.floor(Math.min(tl.x, tr.x, bl.x, br.x) / pSize);
    const maxX = Math.ceil(Math.max(tl.x, tr.x, bl.x, br.x) / pSize);
    const minY = Math.floor(Math.min(tl.y, tr.y, bl.y, br.y) / pSize);
    const maxY = Math.ceil(Math.max(tl.y, tr.y, bl.y, br.y) / pSize);
    
    for (let y = Math.max(0, minY); y < Math.min(h, maxY); y++) {
      for (let x = Math.max(0, minX); x < Math.min(w, maxX); x++) {
        const i = (y * w + x) * 4;
        const brightness = (imgData[i] + imgData[i+1] + imgData[i+2]) / 3;
        const radius = (1 - brightness / 255) * (pSize / 2 * 1.2);
        if (radius > 0.5) {
          c.beginPath();
          c.arc(x * pSize + pSize/2, y * pSize + pSize/2, radius, 0, Math.PI*2);
          c.fill();
        }
      }
    }
  }
  else if (style === 'pencil') {
    c.fillStyle = '#eee';
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.filter = 'grayscale(1)';
    c.drawImage(delayedBuf, 0, 0, canvas.width, canvas.height);
    
    offCanvas.width = canvas.width; offCanvas.height = canvas.height;
    offCtx.filter = 'grayscale(1) invert(1) blur(3px)';
    offCtx.drawImage(delayedBuf, 0, 0, canvas.width, canvas.height);
    offCtx.filter = 'none';
    
    c.globalCompositeOperation = 'color-dodge';
    c.drawImage(offCanvas, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.filter = 'none';
    
    c.globalCompositeOperation = 'multiply';
    c.fillStyle = 'rgba(0,0,0,0.4)';
    c.fillRect(0,0, canvas.width, canvas.height);
    c.globalCompositeOperation = 'source-over';
  }
  else if (style === 'popart') {
    c.filter = 'grayscale(1) contrast(50)';
    c.drawImage(delayedBuf, 0, 0, canvas.width, canvas.height);
    c.filter = 'none';
    
    c.globalCompositeOperation = 'lighten';
    c.fillStyle = '#ff007f';
    c.fillRect(0, 0, canvas.width, canvas.height);
    
    c.globalCompositeOperation = 'multiply';
    c.fillStyle = '#00ffff';
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.globalCompositeOperation = 'source-over';
  }
  else if (style === 'emoji') {
    const pSize = Math.max(12, Math.floor(24 * stretchIntensity));
    const w = Math.ceil(canvas.width / pSize);
    const h = Math.ceil(canvas.height / pSize);
    offCanvas.width = w; offCanvas.height = h;
    offCtx.drawImage(delayedBuf, 0, 0, w, h);
    const imgData = offCtx.getImageData(0, 0, w, h).data;
    
    c.fillStyle = '#0a0a0a';
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.font = `${pSize}px "Apple Color Emoji", sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#ffffff'; // Fallback text color for monochrome rendering
    
    const emojis = ['🌑','🌒','🌓','🌔','🌕'];
    
    const minX = Math.floor(Math.min(tl.x, tr.x, bl.x, br.x) / pSize);
    const maxX = Math.ceil(Math.max(tl.x, tr.x, bl.x, br.x) / pSize);
    const minY = Math.floor(Math.min(tl.y, tr.y, bl.y, br.y) / pSize);
    const maxY = Math.ceil(Math.max(tl.y, tr.y, bl.y, br.y) / pSize);
    
    for (let y = Math.max(0, minY); y < Math.min(h, maxY); y++) {
      for (let x = Math.max(0, minX); x < Math.min(w, maxX); x++) {
        const i = (y * w + x) * 4;
        const brightness = (imgData[i] + imgData[i+1] + imgData[i+2]) / 3;
        const idx = Math.min(emojis.length - 1, Math.floor((brightness / 256) * emojis.length));
        c.fillText(emojis[idx], x * pSize + pSize/2, y * pSize + pSize/2);
      }
    }
  }
  else if (style === 'dice') {
    const pSize = Math.max(12, Math.floor(20 * stretchIntensity));
    const w = Math.ceil(canvas.width / pSize);
    const h = Math.ceil(canvas.height / pSize);
    offCanvas.width = w; offCanvas.height = h;
    offCtx.drawImage(delayedBuf, 0, 0, w, h);
    const imgData = offCtx.getImageData(0, 0, w, h).data;
    
    c.fillStyle = '#f0f0f0';
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.font = `bold ${pSize}px sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#111111';
    
    const chars = ['⚅','⚄','⚃','⚂','⚁','⚀'];
    
    const minX = Math.floor(Math.min(tl.x, tr.x, bl.x, br.x) / pSize);
    const maxX = Math.ceil(Math.max(tl.x, tr.x, bl.x, br.x) / pSize);
    const minY = Math.floor(Math.min(tl.y, tr.y, bl.y, br.y) / pSize);
    const maxY = Math.ceil(Math.max(tl.y, tr.y, bl.y, br.y) / pSize);
    
    for (let y = Math.max(0, minY); y < Math.min(h, maxY); y++) {
      for (let x = Math.max(0, minX); x < Math.min(w, maxX); x++) {
        const i = (y * w + x) * 4;
        const brightness = (imgData[i] + imgData[i+1] + imgData[i+2]) / 3;
        const idx = Math.min(chars.length - 1, Math.floor((brightness / 256) * chars.length));
        c.fillText(chars[idx], x * pSize + pSize/2, y * pSize + pSize/2);
      }
    }
  }
  else if (style === 'heart') {
    const pSize = Math.max(12, Math.floor(22 * stretchIntensity));
    const w = Math.ceil(canvas.width / pSize);
    const h = Math.ceil(canvas.height / pSize);
    offCanvas.width = w; offCanvas.height = h;
    offCtx.drawImage(delayedBuf, 0, 0, w, h);
    const imgData = offCtx.getImageData(0, 0, w, h).data;
    
    c.fillStyle = '#1a0510';
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.font = `${pSize}px "Apple Color Emoji", sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#ff66b2';
    
    const chars = ['🖤','🤎','💜','💖','🤍'];
    
    const minX = Math.floor(Math.min(tl.x, tr.x, bl.x, br.x) / pSize);
    const maxX = Math.ceil(Math.max(tl.x, tr.x, bl.x, br.x) / pSize);
    const minY = Math.floor(Math.min(tl.y, tr.y, bl.y, br.y) / pSize);
    const maxY = Math.ceil(Math.max(tl.y, tr.y, bl.y, br.y) / pSize);
    
    for (let y = Math.max(0, minY); y < Math.min(h, maxY); y++) {
      for (let x = Math.max(0, minX); x < Math.min(w, maxX); x++) {
        const i = (y * w + x) * 4;
        const brightness = (imgData[i] + imgData[i+1] + imgData[i+2]) / 3;
        const idx = Math.min(chars.length - 1, Math.floor((brightness / 256) * chars.length));
        c.fillText(chars[idx], x * pSize + pSize/2, y * pSize + pSize/2);
      }
    }
  }
  else if (style === 'blocks') {
    const pSize = Math.max(8, Math.floor(16 * stretchIntensity));
    const w = Math.ceil(canvas.width / pSize);
    const h = Math.ceil(canvas.height / pSize);
    offCanvas.width = w; offCanvas.height = h;
    offCtx.drawImage(delayedBuf, 0, 0, w, h);
    const imgData = offCtx.getImageData(0, 0, w, h).data;
    
    c.fillStyle = '#000000';
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.font = `${pSize}px monospace`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#00ffcc';
    
    const chars = [' ', '░', '▒', '▓', '█'];
    
    const minX = Math.floor(Math.min(tl.x, tr.x, bl.x, br.x) / pSize);
    const maxX = Math.ceil(Math.max(tl.x, tr.x, bl.x, br.x) / pSize);
    const minY = Math.floor(Math.min(tl.y, tr.y, bl.y, br.y) / pSize);
    const maxY = Math.ceil(Math.max(tl.y, tr.y, bl.y, br.y) / pSize);
    
    for (let y = Math.max(0, minY); y < Math.min(h, maxY); y++) {
      for (let x = Math.max(0, minX); x < Math.min(w, maxX); x++) {
        const i = (y * w + x) * 4;
        const brightness = (imgData[i] + imgData[i+1] + imgData[i+2]) / 3;
        const idx = Math.min(chars.length - 1, Math.floor((brightness / 256) * chars.length));
        c.fillText(chars[idx], x * pSize + pSize/2, y * pSize + pSize/2);
      }
    }
  }
  else if (style === 'flower') {
    const pSize = Math.max(14, Math.floor(26 * stretchIntensity));
    const w = Math.ceil(canvas.width / pSize);
    const h = Math.ceil(canvas.height / pSize);
    offCanvas.width = w; offCanvas.height = h;
    offCtx.drawImage(delayedBuf, 0, 0, w, h);
    const imgData = offCtx.getImageData(0, 0, w, h).data;
    
    c.fillStyle = '#0f1a10';
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.font = `${pSize}px "Apple Color Emoji", sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#ffffff'; 
    
    const chars = ['🥀', '🌹', '🌷', '🌸', '💮'];
    
    const minX = Math.floor(Math.min(tl.x, tr.x, bl.x, br.x) / pSize);
    const maxX = Math.ceil(Math.max(tl.x, tr.x, bl.x, br.x) / pSize);
    const minY = Math.floor(Math.min(tl.y, tr.y, bl.y, br.y) / pSize);
    const maxY = Math.ceil(Math.max(tl.y, tr.y, bl.y, br.y) / pSize);
    
    for (let y = Math.max(0, minY); y < Math.min(h, maxY); y++) {
      for (let x = Math.max(0, minX); x < Math.min(w, maxX); x++) {
        const i = (y * w + x) * 4;
        const brightness = (imgData[i] + imgData[i+1] + imgData[i+2]) / 3;
        const idx = Math.min(chars.length - 1, Math.floor((brightness / 256) * chars.length));
        c.fillText(chars[idx], x * pSize + pSize/2, y * pSize + pSize/2);
      }
    }
  }
  else if (style === 'pointcloud') {
    const pSize = Math.max(4, Math.floor(10 * stretchIntensity));
    const w = Math.ceil(canvas.width / pSize);
    const h = Math.ceil(canvas.height / pSize);
    offCanvas.width = w; offCanvas.height = h;
    offCtx.drawImage(delayedBuf, 0, 0, w, h);
    const imgData = offCtx.getImageData(0, 0, w, h).data;
    
    c.fillStyle = '#050510';
    c.fillRect(0, 0, canvas.width, canvas.height);
    
    const t = performance.now() * 0.001;
    const rotX = Math.sin(t * 0.5) * 0.2;
    const rotY = Math.cos(t * 0.7) * 0.2;
    
    const minX = Math.floor(Math.min(tl.x, tr.x, bl.x, br.x) / pSize);
    const maxX = Math.ceil(Math.max(tl.x, tr.x, bl.x, br.x) / pSize);
    const minY = Math.floor(Math.min(tl.y, tr.y, bl.y, br.y) / pSize);
    const maxY = Math.ceil(Math.max(tl.y, tr.y, bl.y, br.y) / pSize);
    
    for (let y = Math.max(0, minY); y < Math.min(h, maxY); y++) {
      for (let x = Math.max(0, minX); x < Math.min(w, maxX); x++) {
        const i = (y * w + x) * 4;
        const r = imgData[i], g = imgData[i+1], b = imgData[i+2];
        const brightness = (r + g + b) / 3;
        
        const z = (brightness - 128) * 0.5 * stretchIntensity;
        
        let px = x * pSize + pSize/2 - cx;
        let py = y * pSize + pSize/2 - cy;
        
        let px3d = px * Math.cos(rotY) - z * Math.sin(rotY);
        let pz3d = px * Math.sin(rotY) + z * Math.cos(rotY);
        
        let py3d = py * Math.cos(rotX) - pz3d * Math.sin(rotX);
        pz3d = py * Math.sin(rotX) + pz3d * Math.cos(rotX);
        
        const focal = 600;
        const scale = focal / (focal + pz3d + 200);
        
        const finalX = cx + px3d * scale;
        const finalY = cy + py3d * scale;
        
        const ptSize = (1.5 + (brightness/255) * 2) * scale;
        
        c.beginPath();
        c.arc(finalX, finalY, Math.max(0.5, ptSize), 0, Math.PI*2);
        c.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.4 + 0.6*(brightness/255)})`;
        c.fill();
      }
    }
  }
  else if (style === 'crt') {
    const pSize = Math.max(3, Math.floor(9 * stretchIntensity)); 
    const w = Math.ceil(canvas.width / pSize);
    const h = Math.ceil(canvas.height / pSize);
    offCanvas.width = w; offCanvas.height = h;
    offCtx.drawImage(delayedBuf, 0, 0, w, h);
    const imgData = offCtx.getImageData(0, 0, w, h).data;
    
    c.fillStyle = '#000';
    c.fillRect(0, 0, canvas.width, canvas.height);
    
    const minX = Math.floor(Math.min(tl.x, tr.x, bl.x, br.x) / pSize);
    const maxX = Math.ceil(Math.max(tl.x, tr.x, bl.x, br.x) / pSize);
    const minY = Math.floor(Math.min(tl.y, tr.y, bl.y, br.y) / pSize);
    const maxY = Math.ceil(Math.max(tl.y, tr.y, bl.y, br.y) / pSize);
    
    c.globalCompositeOperation = 'screen';
    for (let y = Math.max(0, minY); y < Math.min(h, maxY); y++) {
      for (let x = Math.max(0, minX); x < Math.min(w, maxX); x++) {
        const i = (y * w + x) * 4;
        const rx = x * pSize;
        const ry = y * pSize;
        const cellW = pSize / 3;
        
        c.fillStyle = `rgb(${imgData[i]}, 0, 0)`;
        c.fillRect(rx, ry + 1, cellW * 0.9, pSize - 2);
        
        c.fillStyle = `rgb(0, ${imgData[i+1]}, 0)`;
        c.fillRect(rx + cellW, ry + 1, cellW * 0.9, pSize - 2);
        
        c.fillStyle = `rgb(0, 0, ${imgData[i+2]})`;
        c.fillRect(rx + cellW * 2, ry + 1, cellW * 0.9, pSize - 2);
      }
    }
    c.globalCompositeOperation = 'source-over';
    
    c.fillStyle = 'rgba(0,0,0,0.3)';
    for(let y=0; y<canvas.height; y+=pSize) {
      c.fillRect(0, y, canvas.width, pSize * 0.3);
    }
  }
  else if (style === 'kaleidoscope') {
    c.fillStyle = '#000';
    c.fillRect(0, 0, canvas.width, canvas.height);
    
    c.save();
    c.translate(cx, cy);
    
    const time = performance.now() * 0.0005;
    c.rotate(time);
    
    for (let i = 0; i < 6; i++) {
      c.save();
      c.rotate(i * Math.PI / 3);
      
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(canvas.width, 0);
      c.lineTo(canvas.width * Math.cos(Math.PI/3), canvas.width * Math.sin(Math.PI/3));
      c.closePath();
      c.clip();
      
      if (i % 2 === 1) {
         c.rotate(Math.PI/3);
         c.scale(1, -1);
      }
      
      c.rotate(-time); 
      c.translate(-canvas.width/2, -canvas.height/2);
      c.drawImage(delayedBuf, 0, 0, canvas.width, canvas.height);
      
      c.restore();
    }
    c.restore();
  }

  // Style transition flash
  if (styleTransitionT > 0 && !isPinning) {
    c.fillStyle = `rgba(255, 255, 255, ${styleTransitionT})`;
    c.fill();
  }
   // Center Sag Shading (3D Depth)
  c.globalCompositeOperation = 'multiply';
  const sagGrad = c.createRadialGradient(cx, cy, 0, cx, cy, canvas.width * 0.4);
  const sagAlpha = 0.2 + 0.6 * stretchIntensity;
  sagGrad.addColorStop(0, `rgba(10, 25, 40, ${sagAlpha})`); 
  sagGrad.addColorStop(0.5, `rgba(200, 200, 200, 1)`); 
  sagGrad.addColorStop(1, `rgba(255, 255, 255, 1)`); 
  c.fillStyle = sagGrad;
  c.fill();
  c.globalCompositeOperation = 'source-over';
  
  // Draw Finger Ripples
  if (!isPinning) {
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.radius += 6;
      r.life -= 0.035;
      if (r.life <= 0) {
        ripples.splice(i, 1);
        continue;
      }
      
      c.save();
      c.beginPath();
      c.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
      c.clip();
      
      c.translate(r.x, r.y);
      const bulge = 1.03 + 0.05 * r.life;
      c.scale(bulge, bulge);
      c.translate(-r.x, -r.y);
      c.drawImage(canvas, 0, 0); 
      
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = 'overlay';
      const grad = c.createRadialGradient(r.x, r.y, r.radius * 0.7, r.x, r.y, r.radius);
      grad.addColorStop(0, 'rgba(128,128,128,0)');
      grad.addColorStop(0.5, `rgba(255,255,255,${0.6 * r.life})`);
      grad.addColorStop(0.8, `rgba(0,0,0,${0.6 * r.life})`);
      grad.addColorStop(1, 'rgba(128,128,128,0)');
      c.fillStyle = grad;
      c.fillRect(r.x - r.radius, r.y - r.radius, r.radius*2, r.radius*2);
      c.restore();
    }
  }
  
  c.restore();

  // Glass Overlay
  c.save();
  c.globalAlpha = alpha;
  drawElasticQuad(c);
  const glassGrad = c.createLinearGradient(tl.x, tl.y, br.x, br.y);
  glassGrad.addColorStop(0, `rgba(180,77,255,0.1)`);
  glassGrad.addColorStop(0.5, `rgba(0,212,255,0.05)`);
  glassGrad.addColorStop(1, `rgba(255,107,181,0.1)`);
  c.fillStyle = glassGrad;
  c.fill();
  c.restore();

  // Glowing Borders
  c.save();
  c.globalAlpha = alpha;
  c.shadowColor = 'rgba(0,212,255,0.7)';
  c.shadowBlur = 15;
  c.strokeStyle = 'rgba(0,212,255,0.8)';
  c.lineWidth = 2.5;
  drawElasticQuad(c);
  c.stroke();
  
  // 3D Inner Highlight Bevel
  c.translate(-2, -2);
  c.strokeStyle = 'rgba(255,255,255,0.6)';
  c.lineWidth = 1.5;
  c.stroke();
  c.restore();

  // Corner Glows
  if (!isPinning) {
    c.save();
    c.globalAlpha = alpha;
    const cornerPts = [tl, tr, br, bl];
    for (const pt of cornerPts) {
      const rg = c.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, 25);
      rg.addColorStop(0, 'rgba(255,107,181,0.7)');
      rg.addColorStop(1, 'rgba(255,107,181,0)');
      c.fillStyle = rg;
      c.beginPath(); c.arc(pt.x, pt.y, 25, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }
}

// ============================================================
// State machine & main loop
// ============================================================

function updateState() {
  const hadTwoHands = isCanvasActive;
  
  if (!handsData || !handsData.multiHandLandmarks || handsData.multiHandLandmarks.length < 2) {
    isCanvasActive = false;
    setStatus(handsData && handsData.multiHandLandmarks.length === 1 ? 'ready' : 'idle');
    
    // If we just lost the hands, dismiss the active canvas without pinning
    if (hadTwoHands && membraneState === 'active') {
      membraneState = 'idle';
    }
    return;
  }

  // We have >= 2 hands. Sort by screen X (left to right)
  const lms = [...handsData.multiHandLandmarks].sort((a, b) => {
    return landmarkPx(a[0]).x - landmarkPx(b[0]).x;
  });

  const leftHand = lms[0];
  const rightHand = lms[1];

  // Map to the 4 corners
  targetQuad.tl = landmarkPx(leftHand[8]);
  targetQuad.bl = landmarkPx(leftHand[4]);
  targetQuad.tr = landmarkPx(rightHand[8]);
  targetQuad.br = landmarkPx(rightHand[4]);

  const distIndexL = Math.hypot(leftHand[8].x - leftHand[4].x, leftHand[8].y - leftHand[4].y);
  const distIndexR = Math.hypot(rightHand[8].x - rightHand[4].x, rightHand[8].y - rightHand[4].y);
  
  const distMiddleL = Math.hypot(leftHand[12].x - leftHand[0].x, leftHand[12].y - leftHand[0].y);
  const distMiddleR = Math.hypot(rightHand[12].x - rightHand[0].x, rightHand[12].y - rightHand[0].y);

  if (membraneState === 'cooldown') {
    // Wait until the user un-curls both middle fingers (distance > 0.25) before allowing a new canvas
    if (distMiddleL > 0.25 && distMiddleR > 0.25) {
      membraneState = 'idle';
    }
    isCanvasActive = false;
    return;
  }
  else if (membraneState === 'idle') {
    // Only spawn a new canvas if index and thumb are OPEN
    if (distIndexL > 0.08 && distIndexR > 0.08) {
      quad.tl = { ...targetQuad.tl, vx:0, vy:0 };
      quad.tr = { ...targetQuad.tr, vx:0, vy:0 };
      quad.br = { ...targetQuad.br, vx:0, vy:0 };
      quad.bl = { ...targetQuad.bl, vx:0, vy:0 };
      membraneState = 'active';
      pinchFrames = 0;
    } else {
      isCanvasActive = false;
      return;
    }
  } else if (membraneState === 'active') {
    // Deliberate Pin: MIDDLE FINGER curled to PALM (Wrist [0]), held for 3 frames
    // (Edge rejection removed because the gesture is deliberate enough to avoid accidental pins)
    
    // threshold 0.18 means the finger is curled deeply towards the wrist
    const isPinchingL = distMiddleL < 0.18;
    const isPinchingR = distMiddleR < 0.18;
    
    if (isPinchingL || isPinchingR) {
      pinchFrames++;
      if (pinchFrames > 3) {
        pinCanvas();
        membraneState = 'cooldown'; // Enter cooldown to prevent rapid-fire pinning
        isCanvasActive = false;
        pinchFrames = 0;
        return;
      }
    } else {
      pinchFrames = 0;
    }
  }
  
  // Track fingertips for ripples
  const tipsToCheck = [12, 16, 20]; // Middle, Ring, Pinky
  for (let h = 0; h < 2; h++) {
    for (const idx of tipsToCheck) {
      const id = `${h}-${idx}`;
      const pt = landmarkPx(lms[h][idx]);
      const inside = pointInQuad(pt, quad);
      if (!prevTips[id]) prevTips[id] = { inside: false, x: 0, y: 0 };
      
      if (inside && !prevTips[id].inside) {
        // Just entered, spawn big ripple
        ripples.push({x: pt.x, y: pt.y, radius: 10, life: 1.0});
      } else if (inside && prevTips[id].inside) {
        // Moving inside, spawn small trailing ripples
        const dx = pt.x - prevTips[id].x;
        const dy = pt.y - prevTips[id].y;
        if (dx*dx + dy*dy > 600) { // moved significantly
          ripples.push({x: pt.x, y: pt.y, radius: 5, life: 0.7});
          prevTips[id].x = pt.x;
          prevTips[id].y = pt.y;
        }
      }
      if (!inside || !prevTips[id].inside) {
        prevTips[id] = { x: pt.x, y: pt.y, inside };
      }
    }
  }
  
  isCanvasActive = true;
  setStatus('active');
}

let pinnedCanvases = [];

function pinCanvas() {
  const pad = 30;
  const minX = Math.max(0, Math.floor(Math.min(quad.tl.x, quad.tr.x, quad.bl.x, quad.br.x)) - pad);
  const maxX = Math.min(canvas.width, Math.ceil(Math.max(quad.tl.x, quad.tr.x, quad.bl.x, quad.br.x)) + pad);
  const minY = Math.max(0, Math.floor(Math.min(quad.tl.y, quad.tr.y, quad.bl.y, quad.br.y)) - pad);
  const maxY = Math.min(canvas.height, Math.ceil(Math.max(quad.tl.y, quad.tr.y, quad.bl.y, quad.br.y)) + pad);
  const w = maxX - minX;
  const h = maxY - minY;
  if(w <= 0 || h <= 0) return;
  
  const temp = document.createElement('canvas');
  temp.width = canvas.width;
  temp.height = canvas.height;
  const tCtx = temp.getContext('2d');
  
  // Render snapshot
  drawARCanvas(quad, 1.0, tCtx, true);
  
  // Crop it
  const snapshot = document.createElement('canvas');
  snapshot.width = w;
  snapshot.height = h;
  const sCtx = snapshot.getContext('2d');
  sCtx.drawImage(temp, minX, minY, w, h, 0, 0, w, h);
  
  pinnedCanvases.push({
    snapshot: snapshot,
    bounds: {x: minX, y: minY, w: w, h: h},
    idlePhase: Math.random() * Math.PI * 2
  });
}

function drawPinnedCanvases() {
  const time = performance.now() * 0.001;
  for (const pc of pinnedCanvases) {
    ctx.save();
    const floatY = Math.sin(time + pc.idlePhase) * 6;
    const floatX = Math.cos(time * 0.8 + pc.idlePhase) * 3;
    ctx.translate(pc.bounds.x + floatX, pc.bounds.y + floatY);
    
    ctx.globalAlpha = 0.95;
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 10;
    
    ctx.drawImage(pc.snapshot, 0, 0);
    ctx.restore();
  }
}

// Setup UI Buttons
document.getElementById('btn-undo').addEventListener('click', () => {
  pinnedCanvases.pop();
});
document.getElementById('btn-clear').addEventListener('click', () => {
  pinnedCanvases = [];
});

const SPRING = 0.2;
const FRICTION = 0.65;
function updatePhysicsPt(pt, target) {
  pt.vx += (target.x - pt.x) * SPRING;
  pt.vy += (target.y - pt.y) * SPRING;
  pt.vx *= FRICTION;
  pt.vy *= FRICTION;
  pt.x += pt.vx;
  pt.y += pt.vy;
}

function frame() {
  requestAnimationFrame(frame);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (video.readyState >= 2) {
    drawVideoMirrored();
    
    // Capture to ring buffer
    const buf = frameBuffer[currentBufferIdx];
    buf.ctx.translate(buf.canvas.width, 0);
    buf.ctx.scale(-1, 1);
    buf.ctx.drawImage(video, 0, 0, buf.canvas.width, buf.canvas.height);
    buf.ctx.setTransform(1, 0, 0, 1, 0, 0);
    
    currentBufferIdx = (currentBufferIdx + 1) % FRAME_DELAY;
  }

  updateState();

  // Smooth quad deformation using physics
  if (isCanvasActive) {
    updatePhysicsPt(quad.tl, targetQuad.tl);
    updatePhysicsPt(quad.tr, targetQuad.tr);
    updatePhysicsPt(quad.br, targetQuad.br);
    updatePhysicsPt(quad.bl, targetQuad.bl);
    canvasAlpha = clamp(canvasAlpha + 0.1, 0, 1);
  } else {
    canvasAlpha = clamp(canvasAlpha - 0.2, 0, 1);
  }

  // Draw pinned canvases underneath
  drawPinnedCanvases();

  if (canvasAlpha > 0.01 && membraneState === 'active') {
    drawARCanvas(quad, canvasAlpha);
  }
  
  // Draw shattering particles
  if (membraneState === 'shattering') {
    let alive = false;
    for (const p of particles) {
      if (p.alpha <= 0) continue;
      alive = true;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 1.5; // Gravity
      p.rot += p.rv;
      p.alpha -= 0.03;
      
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = (window.currentFaceStyle === 'neon') ? '#00f3ff' : '#ff9a9e';
      ctx.beginPath();
      ctx.moveTo(-p.size, -p.size);
      ctx.lineTo(p.size, -p.size*0.5);
      ctx.lineTo(0, p.size);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    if (!alive) membraneState = 'idle';
  }

  if (styleTransitionT > 0) {
    styleTransitionT = clamp(styleTransitionT - 0.05, 0, 1);
  }

  if (handsData && handsData.multiHandLandmarks) {
    drawHandLandmarks(handsData.multiHandLandmarks);
  }
}
requestAnimationFrame(frame);

// ============================================================
// UI event handlers
// ============================================================

if (togglePanelBtn) togglePanelBtn.addEventListener('click', () => stylePanel.classList.toggle('open'));
if (togglePanelExtBtn) togglePanelExtBtn.addEventListener('click', () => stylePanel.classList.add('open'));

styleItems.forEach(item => {
  item.addEventListener('click', () => {
    // Remove active from all
    styleItems.forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    
    // Update style
    window.currentFaceStyle = item.dataset.style;
    
    // Trigger transition flash if canvas is open
    if (isCanvasActive) {
      styleTransitionT = 1.0;
    }
  });
});

btnLandmarks.addEventListener('click', () => {
  showLandmarks = !showLandmarks;
  btnLandmarks.classList.toggle('active', showLandmarks);
});

btnReset.addEventListener('click', () => {
  canvasAlpha = 0;
  isCanvasActive = false;
  setStatus('idle');
  initParticles();
});

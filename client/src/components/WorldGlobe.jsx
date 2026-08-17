import React, { useRef, useMemo, useCallback, useState, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Stars, Html } from '@react-three/drei';
import * as THREE from 'three';

// Textures self-hosted from mrdoob/three.js examples/textures/planets (NASA
// Visible Earth imagery, as used throughout the three.js example gallery).
const EARTH_MAP = '/textures/earth_atmos_2048.jpg';
const EARTH_BUMP = '/textures/earth_normal_2048.jpg';
const EARTH_SPEC = '/textures/earth_specular_2048.jpg';

const GLOBE_RADIUS = 2;
const GOLD = '#d4af37';
const EARTH_ROTATE_SPEED = 0.025; // rad/s

/** Round soft-glow sprite texture drawn via the Canvas 2D API. */
function makeGlowSprite() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, half * 0.08, half, half, half * 0.55);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.7, 'rgba(212,175,55,0.9)');
  gradient.addColorStop(1, 'rgba(212,175,55,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/** Conic-gradient radar sweep wedge, matching the previous 2D CSS radar look. */
function makeRadarSweepTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2;
  ctx.clearRect(0, 0, size, size);
  const startAngle = -Math.PI / 2;
  const sweepAngle = Math.PI / 3;
  const grad = ctx.createConicGradient
    ? ctx.createConicGradient(startAngle, cx, cy)
    : null;
  if (grad) {
    grad.addColorStop(0, 'rgba(212,175,55,0)');
    grad.addColorStop((sweepAngle) / (2 * Math.PI), 'rgba(212,175,55,0.55)');
    grad.addColorStop((sweepAngle + 0.001) / (2 * Math.PI), 'rgba(212,175,55,0)');
    grad.addColorStop(1, 'rgba(212,175,55,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Fallback for engines without createConicGradient: draw the wedge manually.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, startAngle, startAngle + sweepAngle);
    ctx.closePath();
    const wedgeGrad = ctx.createLinearGradient(0, 0, r, 0);
    wedgeGrad.addColorStop(0, 'rgba(212,175,55,0.55)');
    wedgeGrad.addColorStop(1, 'rgba(212,175,55,0.05)');
    ctx.fillStyle = wedgeGrad;
    ctx.fill();
    ctx.restore();
  }
  ctx.strokeStyle = 'rgba(212,175,55,0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 2, 0, Math.PI * 2);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// ─── Procedural planet textures (ported from the mrdoob/three.js-derived
// reference solar system — pure canvas drawing, no external assets) ─────────

function makeJupiterTex() {
  const W = 1024, H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const bd = [
    [0.00, '#c07030'], [0.06, '#f0d090'], [0.12, '#b85820'], [0.18, '#e8c880'],
    [0.25, '#d07838'], [0.32, '#f4e09a'], [0.40, '#c06828'], [0.48, '#f0cc80'],
    [0.54, '#c88040'], [0.60, '#e8c078'], [0.66, '#b86020'], [0.72, '#ecc880'],
    [0.78, '#c07830'], [0.86, '#f0d090'], [0.93, '#c06030'], [1.00, '#c07030'],
  ];
  for (let i = 0; i < bd.length - 1; i++) {
    const y1 = bd[i][0] * H, y2 = bd[i + 1][0] * H;
    const g = ctx.createLinearGradient(0, y1, 0, y2);
    g.addColorStop(0, bd[i][1]); g.addColorStop(1, bd[i + 1][1]);
    ctx.fillStyle = g; ctx.fillRect(0, y1, W, y2 - y1 + 1);
  }
  ctx.globalAlpha = 0.14;
  for (let y = 0; y < H; y += 3) {
    const wave = Math.sin(y * 0.06) * 14 + Math.sin(y * 0.025) * 20;
    const dark = ((y / H * bd.length) | 0) % 2 === 0;
    for (let x = 0; x < W; x += 3)
      if (Math.sin((x + wave) * 0.035 + y * 0.015) > 0.62) {
        ctx.fillStyle = dark ? 'rgba(70,30,5,1)' : 'rgba(250,210,130,1)';
        ctx.fillRect(x, y, 3, 3);
      }
  }
  ctx.globalAlpha = 1;
  ctx.save(); ctx.translate(W * 0.68, H * 0.575); ctx.scale(1, 0.5);
  const grs = ctx.createRadialGradient(0, 0, 0, 0, 0, W * 0.056);
  grs.addColorStop(0, 'rgba(175,50,15,0.97)'); grs.addColorStop(0.35, 'rgba(185,65,22,0.83)');
  grs.addColorStop(0.68, 'rgba(160,68,28,0.55)'); grs.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grs; ctx.beginPath(); ctx.arc(0, 0, W * 0.056, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  return new THREE.CanvasTexture(canvas);
}

function makeSaturnTex() {
  const W = 1024, H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const bd = [
    [0.00, '#d4b870'], [0.10, '#e8cc88'], [0.22, '#c8a858'], [0.34, '#ead8a0'],
    [0.46, '#d0b868'], [0.56, '#ecdca8'], [0.66, '#c8a858'], [0.76, '#ead8a0'],
    [0.86, '#d4b870'], [1.00, '#d4b870'],
  ];
  for (let i = 0; i < bd.length - 1; i++) {
    const y1 = bd[i][0] * H, y2 = bd[i + 1][0] * H;
    const g = ctx.createLinearGradient(0, y1, 0, y2);
    g.addColorStop(0, bd[i][1]); g.addColorStop(1, bd[i + 1][1]);
    ctx.fillStyle = g; ctx.fillRect(0, y1, W, y2 - y1 + 1);
  }
  ctx.globalAlpha = 0.08;
  for (let y = 0; y < H; y += 4) {
    const wave = Math.sin(y * 0.04) * 10;
    for (let x = 0; x < W; x += 4)
      if (Math.sin((x + wave) * 0.03 + y * 0.01) > 0.6) {
        ctx.fillStyle = ((y / H * 9) | 0) % 2 === 0 ? 'rgba(100,70,20,1)' : 'rgba(255,235,165,1)';
        ctx.fillRect(x, y, 4, 4);
      }
  }
  ctx.globalAlpha = 1;
  return new THREE.CanvasTexture(canvas);
}

function makeSaturnRingTex() {
  const W = 512, H = 1;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.05, 'rgba(160,140,100,0.15)');
  g.addColorStop(0.20, 'rgba(200,180,130,0.55)');
  g.addColorStop(0.42, 'rgba(235,215,165,0.88)');
  g.addColorStop(0.56, 'rgba(210,190,140,0.72)');
  g.addColorStop(0.60, 'rgba(12,6,2,0.08)');
  g.addColorStop(0.63, 'rgba(12,6,2,0.06)');
  g.addColorStop(0.68, 'rgba(190,170,120,0.60)');
  g.addColorStop(0.82, 'rgba(175,155,108,0.48)');
  g.addColorStop(0.90, 'rgba(155,138,98,0.28)');
  g.addColorStop(1.00, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  return new THREE.CanvasTexture(canvas);
}

function makeMarsTex() {
  const W = 1024, H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, '#e0e0d8'); base.addColorStop(0.07, '#cc5030');
  base.addColorStop(0.28, '#c84c2a'); base.addColorStop(0.50, '#d05c38');
  base.addColorStop(0.58, '#b03c24'); base.addColorStop(0.72, '#cc5030');
  base.addColorStop(0.90, '#c04428'); base.addColorStop(0.95, '#e0e0d8');
  base.addColorStop(1, '#f0f0e8');
  ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
  const patches = [
    [0.35, 0.40, 0.12, 0.09, 'rgba(90,28,8,0.38)'],
    [0.62, 0.52, 0.26, 0.06, 'rgba(80,22,6,0.45)'],
    [0.77, 0.46, 0.09, 0.08, 'rgba(75,18,5,0.35)'],
    [0.14, 0.43, 0.07, 0.07, 'rgba(100,38,12,0.30)'],
    [0.50, 0.35, 0.06, 0.05, 'rgba(85,25,8,0.28)'],
  ];
  for (const [px, py, rx, ry, c] of patches) {
    ctx.save(); ctx.translate(px * W, py * H); ctx.scale(rx * W, ry * H);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, c); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  const ncap = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, H * 0.11);
  ncap.addColorStop(0, 'rgba(245,245,238,0.97)'); ncap.addColorStop(0.55, 'rgba(230,230,220,0.75)'); ncap.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = ncap; ctx.fillRect(0, 0, W, H * 0.15);
  const scap = ctx.createRadialGradient(W / 2, H, 0, W / 2, H, H * 0.09);
  scap.addColorStop(0, 'rgba(248,248,240,0.95)'); scap.addColorStop(0.55, 'rgba(230,228,218,0.65)'); scap.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = scap; ctx.fillRect(0, H * 0.86, W, H * 0.14);
  return new THREE.CanvasTexture(canvas);
}

function makeMercuryTex() {
  const W = 512, H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#8a7e70'; ctx.fillRect(0, 0, W, H);
  const spots = [
    [0.20, 0.40, 0.12, 'rgba(48,38,28,0.32)'], [0.50, 0.60, 0.10, 'rgba(58,48,35,0.28)'],
    [0.75, 0.34, 0.08, 'rgba(118,108,88,0.38)'], [0.90, 0.62, 0.07, 'rgba(48,38,28,0.22)'],
    [0.35, 0.28, 0.06, 'rgba(108,98,78,0.30)'], [0.62, 0.45, 0.09, 'rgba(42,32,22,0.25)'],
  ];
  for (const [px, py, pr, pc] of spots) {
    const g = ctx.createRadialGradient(px * W, py * H, 0, px * W, py * H, pr * W);
    g.addColorStop(0, pc); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  return new THREE.CanvasTexture(canvas);
}

function makeVenusTex() {
  const W = 512, H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, '#f8e8b0'); base.addColorStop(0.3, '#f0d888');
  base.addColorStop(0.5, '#e8cc78'); base.addColorStop(0.7, '#f0d888');
  base.addColorStop(1, '#f8e8b0');
  ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.20;
  for (let y = 0; y < H; y += 3) {
    const wave = Math.sin(y * 0.04) * 18 + Math.sin(y * 0.016) * 12;
    for (let x = 0; x < W; x += 3)
      if (Math.sin((x + wave) * 0.025 + y * 0.012) > 0.5) {
        ctx.fillStyle = Math.sin((x + wave) * 0.025 + y * 0.012) > 0.75 ? 'rgba(215,175,55,1)' : 'rgba(255,240,155,1)';
        ctx.fillRect(x, y, 3, 3);
      }
  }
  ctx.globalAlpha = 1;
  return new THREE.CanvasTexture(canvas);
}

function makeUranusTex() {
  const W = 256, H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#72ccd4'); g.addColorStop(0.35, '#80dce4');
  g.addColorStop(0.5, '#78d2da'); g.addColorStop(0.65, '#80dce4'); g.addColorStop(1, '#72ccd4');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  return new THREE.CanvasTexture(canvas);
}

function makeNeptuneTex() {
  const W = 256, H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#2858c8'); g.addColorStop(0.3, '#2048b8');
  g.addColorStop(0.5, '#3060d0'); g.addColorStop(0.7, '#2048b8'); g.addColorStop(1, '#2858c8');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.32;
  for (let y = 0; y < H; y += 4) {
    const wave = Math.sin(y * 0.08) * 6;
    for (let x = 0; x < W; x += 4)
      if (Math.sin((x + wave) * 0.05 + y * 0.02) > 0.62) {
        ctx.fillStyle = 'rgba(148,188,238,1)'; ctx.fillRect(x, y, 4, 2);
      }
  }
  ctx.globalAlpha = 1;
  ctx.save(); ctx.translate(W * 0.55, H * 0.45); ctx.scale(1, 0.5);
  const ds = ctx.createRadialGradient(0, 0, 0, 0, 0, W * 0.09);
  ds.addColorStop(0, 'rgba(18,28,95,0.88)'); ds.addColorStop(0.7, 'rgba(18,28,95,0.4)'); ds.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = ds; ctx.beginPath(); ctx.arc(0, 0, W * 0.09, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  return new THREE.CanvasTexture(canvas);
}

function latLonToVec3(lat, lon, r) {
  const phi = (lat * Math.PI) / 180;
  const theta = (lon * Math.PI) / 180;
  return new THREE.Vector3(
    r * Math.cos(phi) * Math.cos(theta),
    r * Math.sin(phi),
    -r * Math.cos(phi) * Math.sin(theta),
  );
}

function tangentQuaternion(position) {
  const normal = position.clone().normalize();
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
}

function GlobeMesh() {
  const { gl } = useThree();
  const [mapTex, bumpTex, specTex] = useMemo(() => {
    const loader = new THREE.TextureLoader();
    const maxAniso = gl.capabilities.getMaxAnisotropy();
    const load = (url) => {
      const t = loader.load(url);
      t.anisotropy = maxAniso;
      return t;
    };
    return [load(EARTH_MAP), load(EARTH_BUMP), load(EARTH_SPEC)];
  }, [gl]);

  return (
    <mesh>
      <sphereGeometry args={[GLOBE_RADIUS, 96, 96]} />
      <meshPhongMaterial
        map={mapTex}
        bumpMap={bumpTex}
        bumpScale={0.15}
        specularMap={specTex}
        specular={new THREE.Color(0x223355)}
        shininess={10}
        emissive={new THREE.Color(0x1a1408)}
        emissiveIntensity={0.15}
      />
    </mesh>
  );
}

function Atmosphere() {
  return (
    <>
      <mesh scale={1.015}>
        <sphereGeometry args={[GLOBE_RADIUS, 32, 32]} />
        <meshStandardMaterial color="#d4af37" transparent opacity={0.08} side={THREE.BackSide} />
      </mesh>
      <mesh scale={1.045}>
        <sphereGeometry args={[GLOBE_RADIUS, 32, 32]} />
        <meshStandardMaterial color="#d4af37" transparent opacity={0.04} side={THREE.BackSide} />
      </mesh>
    </>
  );
}

function GridLines() {
  const geo = useMemo(() => {
    const pts = [];
    const r = GLOBE_RADIUS * 1.003;
    for (let lat = -80; lat <= 80; lat += 20) {
      const phi = (lat * Math.PI) / 180;
      for (let i = 0; i <= 128; i++) {
        const lon = (i / 128) * 2 * Math.PI;
        pts.push(r * Math.cos(phi) * Math.cos(lon), r * Math.sin(phi), -r * Math.cos(phi) * Math.sin(lon));
      }
    }
    for (let lon = 0; lon < 360; lon += 30) {
      const theta = (lon * Math.PI) / 180;
      for (let i = 0; i <= 64; i++) {
        const phi = ((i / 64) * 180 - 90) * (Math.PI / 180);
        pts.push(r * Math.cos(phi) * Math.cos(theta), r * Math.sin(phi), -r * Math.cos(phi) * Math.sin(theta));
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);

  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color="#d4af37" transparent opacity={0.12} />
    </lineSegments>
  );
}

/** Visibility toggle shared by markers/radar riding on the rotating globe:
 * checks the object's actual WORLD-space position (not a stale local-space
 * value) against the camera direction, so it stays correct as the globe spins. */
function useFrontFacingVisibility(groupRef) {
  const scratch = useMemo(() => new THREE.Vector3(), []);
  return (camera) => {
    if (!groupRef.current) return true;
    groupRef.current.getWorldPosition(scratch);
    return scratch.normalize().dot(camera.position.clone().normalize());
  };
}

function RadarSweep({ centerLat, centerLon }) {
  const sweepRef = useRef(null);
  const groupRef = useRef(null);
  const tex = useMemo(() => makeRadarSweepTexture(), []);
  const position = useMemo(
    () => latLonToVec3(centerLat, centerLon, GLOBE_RADIUS * 1.012),
    [centerLat, centerLon],
  );
  const quaternion = useMemo(() => tangentQuaternion(position), [position]);
  const facing = useFrontFacingVisibility(groupRef);

  useFrame(({ camera }, delta) => {
    if (sweepRef.current) sweepRef.current.rotation.z -= delta * ((Math.PI * 2) / 6);
    if (groupRef.current) groupRef.current.visible = facing(camera) > 0.55;
  });

  return (
    <group ref={groupRef} position={position} quaternion={quaternion}>
      <mesh ref={sweepRef}>
        <circleGeometry args={[0.42, 64]} />
        <meshBasicMaterial map={tex} transparent depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function CityMarker({ city, onSelect }) {
  const glowTex = useMemo(() => makeGlowSprite(), []);
  const ringRef = useRef(null);
  const groupRef = useRef(null);
  const [hovered, setHovered] = useState(false);
  const phase = useMemo(() => Math.random() * Math.PI * 2, []);
  const position = useMemo(
    () => latLonToVec3(city.lat, city.lon, GLOBE_RADIUS * 1.008),
    [city.lat, city.lon],
  );
  const quaternion = useMemo(() => tangentQuaternion(position), [position]);
  const facing = useFrontFacingVisibility(groupRef);

  useFrame(({ clock, camera }) => {
    if (ringRef.current) {
      const t = ((clock.elapsedTime + phase) % 2) / 2;
      ringRef.current.scale.setScalar(1 + t * 2.2);
      ringRef.current.material.opacity = Math.max(0, 0.55 * (1 - t));
    }
    if (groupRef.current) groupRef.current.visible = facing(camera) > 0.08;
  });

  return (
    <group ref={groupRef} position={position} quaternion={quaternion}>
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onSelect(city);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = 'auto';
        }}
      >
        <circleGeometry args={[0.11, 24]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh>
        <circleGeometry args={[0.028, 24]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <sprite scale={[0.09, 0.09, 0.09]}>
        <spriteMaterial map={glowTex} transparent depthWrite={false} opacity={0.9} />
      </sprite>
      <mesh ref={ringRef}>
        <ringGeometry args={[0.035, 0.045, 32]} />
        <meshBasicMaterial color={GOLD} transparent depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {hovered && (
        <Html zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <div className="-translate-x-1/2 -translate-y-[220%] whitespace-nowrap text-[11px] font-bold text-white px-2 py-0.5 rounded bg-black/70 border border-gold/40">
            {city.name}
          </div>
        </Html>
      )}
    </group>
  );
}

/** Earth + graticule + radar + city markers, spinning together on the polar
 * axis so markers stay glued to their real coordinates as the globe turns. */
function RotatingGlobe({ centerLat, centerLon, cities, onSelectCity, rotRef }) {
  const groupRef = useRef(null);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y += delta * EARTH_ROTATE_SPEED;
    rotRef.current = groupRef.current.rotation.y;
  });

  return (
    <group ref={groupRef}>
      <GlobeMesh />
      <GridLines />
      <RadarSweep centerLat={centerLat} centerLon={centerLon} />
      {cities.map((city) => (
        <CityMarker key={city.id} city={city} onSelect={onSelectCity} />
      ))}
    </group>
  );
}

// ─── Sun & solar system ──────────────────────────────────────────────────────

function Sun() {
  const groupRef = useRef(null);
  useFrame(({ clock }) => {
    if (groupRef.current) {
      const t = clock.elapsedTime * 0.04;
      groupRef.current.position.set(Math.cos(t) * 18, 4, Math.sin(t) * 18);
    }
  });

  const coronaMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#fff4a0',
    transparent: true,
    opacity: 0.15,
    side: THREE.BackSide,
  }), []);

  return (
    <group ref={groupRef} position={[18, 4, 0]}>
      <mesh>
        <sphereGeometry args={[0.45, 24, 24]} />
        <meshBasicMaterial color="#ffe060" />
      </mesh>
      <mesh scale={1.6}>
        <sphereGeometry args={[0.45, 16, 16]} />
        <primitive object={coronaMat} />
      </mesh>
      <pointLight intensity={4.5} color="#fff8e0" distance={80} decay={1.2} />
    </group>
  );
}

/** Faint orbit ring drawn in the ecliptic plane. */
function OrbitPath({ dist }) {
  const line = useMemo(() => {
    const pts = [];
    const N = 256;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      pts.push(Math.cos(a) * dist, 0, Math.sin(a) * dist);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({ color: '#1a2a5a', transparent: true, opacity: 0.20 });
    return new THREE.Line(geo, mat);
  }, [dist]);

  return <primitive object={line} />;
}

function Planet({ radius, dist, speed, incl, color, roughness = 0.75, map, ringTex }) {
  const ref = useRef(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime * speed;
    ref.current.position.set(
      Math.cos(t) * dist,
      Math.sin(t * 0.35) * dist * incl,
      Math.sin(t) * dist,
    );
  });

  return (
    <group ref={ref}>
      <mesh>
        <sphereGeometry args={[radius, 36, 36]} />
        <meshStandardMaterial
          map={map}
          color={map ? '#ffffff' : color}
          roughness={roughness}
          metalness={0.04}
        />
      </mesh>
      {ringTex && (
        <mesh rotation={[Math.PI * 0.46, 0.18, 0.14]}>
          <ringGeometry args={[radius * 1.38, radius * 2.55, 128]} />
          <meshBasicMaterial map={ringTex} transparent side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

function SolarSystem() {
  const mercuryMap = useMemo(() => makeMercuryTex(), []);
  const venusMap = useMemo(() => makeVenusTex(), []);
  const marsMap = useMemo(() => makeMarsTex(), []);
  const jupiterMap = useMemo(() => makeJupiterTex(), []);
  const saturnMap = useMemo(() => makeSaturnTex(), []);
  const saturnRing = useMemo(() => makeSaturnRingTex(), []);
  const uranusMap = useMemo(() => makeUranusTex(), []);
  const neptuneMap = useMemo(() => makeNeptuneTex(), []);

  return (
    <>
      <group key="mercury">
        <OrbitPath dist={22} />
        <Planet radius={0.10} dist={22} speed={0.074} incl={0.08} color="#8a7e70" roughness={0.92} map={mercuryMap} />
      </group>
      <group key="venus">
        <OrbitPath dist={30} />
        <Planet radius={0.20} dist={30} speed={0.050} incl={0.04} color="#f0d888" roughness={0.55} map={venusMap} />
      </group>
      <group key="mars">
        <OrbitPath dist={45} />
        <Planet radius={0.13} dist={45} speed={0.028} incl={0.17} color="#c04828" roughness={0.88} map={marsMap} />
      </group>
      <group key="jupiter">
        <OrbitPath dist={75} />
        <Planet radius={0.75} dist={75} speed={0.012} incl={0.06} color="#c2956a" roughness={0.55} map={jupiterMap} />
      </group>
      <group key="saturn">
        <OrbitPath dist={110} />
        <Planet radius={0.60} dist={110} speed={0.008} incl={0.18} color="#d4b870" roughness={0.50} map={saturnMap} ringTex={saturnRing} />
      </group>
      <group key="uranus">
        <OrbitPath dist={148} />
        <Planet radius={0.38} dist={148} speed={0.005} incl={0.48} color="#78d4dc" roughness={0.40} map={uranusMap} />
      </group>
      <group key="neptune">
        <OrbitPath dist={185} />
        <Planet radius={0.36} dist={185} speed={0.003} incl={0.10} color="#2858c8" roughness={0.40} map={neptuneMap} />
      </group>
    </>
  );
}

// ─── Intro camera flight ─────────────────────────────────────────────────────

const INTRO_START = new THREE.Vector3(0, 1.4, 24);
const INTRO_DURATION = 2.6;
// Far enough that the full globe (radius 2, fov 42) fits inside the frame
// with room to spare, so the starfield is visible around it too.
const CAM_DIST = 6.4;

/** Flies the camera in from far away, arcing past the globe before settling
 * on the framed target — the swoop comes for free from lerping between two
 * positions that aren't on the same line through the origin. Recomputes the
 * target every frame from the globe's current spin so it always lands on
 * Turkey, not wherever Turkey was when the flight started. */
function IntroCameraRig({ centerLat, centerLon, rotRef, onComplete }) {
  const { camera } = useThree();
  const progressRef = useRef(0);
  const doneRef = useRef(false);

  useFrame((_, delta) => {
    if (doneRef.current) return;
    progressRef.current = Math.min(1, progressRef.current + delta / INTRO_DURATION);
    const eased = 1 - Math.pow(1 - progressRef.current, 3);
    const latR = (centerLat * Math.PI) / 180;
    const lonR = (centerLon * Math.PI) / 180 + (rotRef.current ?? 0);
    const endPos = new THREE.Vector3(
      CAM_DIST * Math.cos(latR) * Math.cos(lonR),
      CAM_DIST * Math.sin(latR),
      -CAM_DIST * Math.cos(latR) * Math.sin(lonR),
    );
    camera.position.lerpVectors(INTRO_START, endPos, eased);
    camera.lookAt(0, 0, 0);
    if (progressRef.current >= 1) {
      doneRef.current = true;
      onComplete?.();
    }
  });

  return null;
}

function Scene({ cities, onSelectCity, centerLat, centerLon, introPlaying, onIntroComplete }) {
  const controlsRef = useRef(null);
  const rotRef = useRef(0);

  return (
    <>
      <ambientLight intensity={2.2} />
      <directionalLight position={[5, 3, 6]} intensity={1.4} color="#fff8f0" />
      <directionalLight position={[-5, 3, -4]} intensity={1} color="#d0e8ff" />
      <Stars radius={260} depth={90} count={5000} factor={4} saturation={0} fade speed={0.3} />
      <Sun />
      <SolarSystem />
      <Atmosphere />
      <RotatingGlobe centerLat={centerLat} centerLon={centerLon} cities={cities} onSelectCity={onSelectCity} rotRef={rotRef} />
      {introPlaying && (
        <IntroCameraRig centerLat={centerLat} centerLon={centerLon} rotRef={rotRef} onComplete={onIntroComplete} />
      )}
      <OrbitControls
        ref={controlsRef}
        enabled={!introPlaying}
        enablePan={false}
        minDistance={2.6}
        maxDistance={220}
        rotateSpeed={0.45}
        zoomSpeed={0.7}
        dampingFactor={0.08}
        enableDamping
      />
    </>
  );
}

export default function WorldGlobe({ cities, onSelectCity, centerLat = 39, centerLon = 33 }) {
  const [introPlaying, setIntroPlaying] = useState(true);
  const [tabVisible, setTabVisible] = useState(!document.hidden);

  const handleSelect = useCallback((city) => onSelectCity?.(city), [onSelectCity]);
  const handleIntroComplete = useCallback(() => setIntroPlaying(false), []);

  // This is a decorative background scene (full orbit-camera solar system +
  // Earth), so its render loop shouldn't keep spending CPU/GPU while the tab
  // is in the background.
  useEffect(() => {
    const onVisibilityChange = () => setTabVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  return (
    <Canvas
      camera={{ position: INTRO_START.toArray(), fov: 42, far: 2000 }}
      style={{ background: 'transparent' }}
      dpr={Math.min(window.devicePixelRatio, 2)}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      frameloop={tabVisible ? 'always' : 'never'}
    >
      <Scene
        cities={cities}
        onSelectCity={handleSelect}
        centerLat={centerLat}
        centerLon={centerLon}
        introPlaying={introPlaying}
        onIntroComplete={handleIntroComplete}
      />
    </Canvas>
  );
}

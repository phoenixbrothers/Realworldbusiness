/**
 * Low-poly isometric campus rendered with React Three Fiber.
 * - frameloop="demand": renders only on interaction (no idle GPU work)
 * - hotspots are real meshes with hover/selected states; labels are DOM
 *   elements so text stays crisp and accessible
 */
import { Canvas, useThree } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { CampusSite } from './Campus';

const PALETTE = { grass: '#3f7d4f', grass2: '#4a8c5a', road: '#5b6573', water: '#2a6fa5', hq: '#7fb6e6', factory: '#c9ced6', warehouse: '#d9d2c4', lab: '#b7a6f0', hub: '#e2734e', roof: '#566270', glass: '#9fd4ff', tree: '#2f6b3d', trunk: '#6b4b2e' };

function Building({ site, selected, hovered, onHover, onSelect }: { site: CampusSite; selected: boolean; hovered: boolean; onHover: (id: string | null) => void; onSelect: (id: string) => void }) {
  const [x, z] = site.pos;
  const lvl = Math.max(1, site.level);
  const ghost = site.status === 'under_construction';
  const emissive = selected ? '#22d6b0' : hovered ? '#4e91ff' : '#000000';
  const ei = selected ? 0.45 : hovered ? 0.3 : 0;
  const mat = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => (
    <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={ei} transparent={ghost} opacity={ghost ? 0.45 : 1} wireframe={false} roughness={0.7} {...extra} />
  );
  const handlers = {
    onPointerOver: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onHover(site.id);
      document.body.style.cursor = 'pointer';
    },
    onPointerOut: () => {
      onHover(null);
      document.body.style.cursor = '';
    },
    onClick: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onSelect(site.id);
    },
  };
  let body: React.ReactNode = null;
  if (site.type === 'hq') {
    const h = 3 + lvl;
    body = (
      <group {...handlers}>
        <mesh position={[0, h / 2, 0]}>
          <boxGeometry args={[2.2, h, 2.2]} />
          {mat(PALETTE.hq, { metalness: 0.4, roughness: 0.25 })}
        </mesh>
        <mesh position={[1.6, 1.2, 0.4]}>
          <boxGeometry args={[1.6, 2.4, 1.8]} />
          {mat(PALETTE.glass, { metalness: 0.5, roughness: 0.2 })}
        </mesh>
        <mesh position={[0, h + 0.15, 0]}>
          <boxGeometry args={[2.3, 0.3, 2.3]} />
          {mat(PALETTE.roof)}
        </mesh>
      </group>
    );
  } else if (site.type === 'factory') {
    body = (
      <group {...handlers}>
        {Array.from({ length: Math.min(3, lvl + 1) }).map((_, i) => (
          <group key={i} position={[(i - 1) * 1.7, 0, 0]}>
            <mesh position={[0, 0.9, 0]}>
              <boxGeometry args={[1.6, 1.8, 3.2]} />
              {mat(PALETTE.factory)}
            </mesh>
            <mesh position={[0, 2.05, 0]} rotation={[0, 0, Math.PI / 4]}>
              <boxGeometry args={[0.9, 0.9, 3.2]} />
              {mat(PALETTE.roof)}
            </mesh>
          </group>
        ))}
        {[-1.2, 0.6].map((cx, i) => (
          <mesh key={i} position={[cx, 3, -1.9]}>
            <cylinderGeometry args={[0.22, 0.3, 3, 10]} />
            {mat('#8e98a6')}
          </mesh>
        ))}
      </group>
    );
  } else if (site.type === 'warehouse') {
    body = (
      <group {...handlers}>
        <mesh position={[0, 0.9, 0]}>
          <boxGeometry args={[3.6 + lvl * 0.4, 1.8, 2.6]} />
          {mat(PALETTE.warehouse)}
        </mesh>
        <mesh position={[0, 1.9, 0]}>
          <boxGeometry args={[3.8 + lvl * 0.4, 0.2, 2.8]} />
          {mat('#3d6fb0')}
        </mesh>
        {[-1, 0, 1].map((i) => (
          <mesh key={i} position={[i * 1.1, 0.5, 1.31]}>
            <boxGeometry args={[0.8, 1, 0.05]} />
            {mat('#7d8794')}
          </mesh>
        ))}
      </group>
    );
  } else if (site.type === 'rnd_lab') {
    body = (
      <group {...handlers}>
        <mesh position={[0, 0.8, 0]}>
          <boxGeometry args={[2.6, 1.6, 2]} />
          {mat(PALETTE.lab)}
        </mesh>
        <mesh position={[0, 1.6 + 0.2 * lvl, 0]}>
          <sphereGeometry args={[0.8, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          {mat(PALETTE.glass, { metalness: 0.5, roughness: 0.2 })}
        </mesh>
      </group>
    );
  } else if (site.type === 'logistics_hub') {
    body = (
      <group {...handlers}>
        <mesh position={[0, 0.5, 0]}>
          <boxGeometry args={[2.4, 1, 1.6]} />
          {mat('#9aa6b4')}
        </mesh>
        {[0, 1].map((i) => (
          <group key={i} position={[-1 + i * 2, 0, 1.6]}>
            <mesh position={[0, 1.8, 0]}>
              <boxGeometry args={[0.2, 3.6, 0.2]} />
              {mat(PALETTE.hub)}
            </mesh>
            <mesh position={[0.6, 3.5, 0]}>
              <boxGeometry args={[1.8, 0.2, 0.2]} />
              {mat(PALETTE.hub)}
            </mesh>
          </group>
        ))}
      </group>
    );
  }
  return (
    <group position={[x, 0, z]}>
      {body}
      <Html position={[0, site.type === 'hq' ? 4.2 + lvl : 3.2, 0]} center zIndexRange={[20, 0]} occlude={false}>
        <button className="hotspot campus-label" aria-pressed={selected} onClick={() => onSelect(site.id)} onMouseEnter={() => onHover(site.id)} onMouseLeave={() => onHover(null)} tabIndex={-1}>
          <span className={`dot ${site.tone}`} aria-hidden />
          <b>{site.label}</b>
          <small>{site.status === 'under_construction' ? 'Building' : `Level ${site.level}`}</small>
        </button>
      </Html>
    </group>
  );
}

function Trees() {
  const trees = useMemo(() => {
    const out: [number, number, number][] = [];
    let s = 7;
    const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 60; i++) {
      const x = -15 + r() * 30;
      const z = -11 + r() * 16;
      if (Math.abs(x) < 9 && Math.abs(z) < 6) continue;
      out.push([x, z, 0.6 + r() * 0.6]);
    }
    return out;
  }, []);
  return (
    <>
      {trees.map(([x, z, s], i) => (
        <group key={i} position={[x, 0, z]} scale={s}>
          <mesh position={[0, 0.4, 0]}>
            <cylinderGeometry args={[0.08, 0.1, 0.8, 6]} />
            <meshStandardMaterial color={PALETTE.trunk} />
          </mesh>
          <mesh position={[0, 1.2, 0]}>
            <coneGeometry args={[0.55, 1.4, 7]} />
            <meshStandardMaterial color={PALETTE.tree} />
          </mesh>
        </group>
      ))}
    </>
  );
}

function Ground() {
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, -2]}>
        <planeGeometry args={[36, 20]} />
        <meshStandardMaterial color={PALETTE.grass} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 11]}>
        <planeGeometry args={[60, 10]} />
        <meshStandardMaterial color={PALETTE.water} roughness={0.3} metalness={0.2} />
      </mesh>
      {/* roads */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0.6]}>
        <planeGeometry args={[30, 1.2]} />
        <meshStandardMaterial color={PALETTE.road} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, -2]}>
        <planeGeometry args={[1.2, 14]} />
        <meshStandardMaterial color={PALETTE.road} />
      </mesh>
      {/* quay with containers */}
      <mesh position={[8, 0.15, 5.6]}>
        <boxGeometry args={[16, 0.3, 1.6]} />
        <meshStandardMaterial color="#8d939b" />
      </mesh>
      {Array.from({ length: 14 }).map((_, i) => (
        <mesh key={i} position={[2 + (i % 7) * 1.1, 0.55 + Math.floor(i / 7) * 0.5, 5.4]}>
          <boxGeometry args={[1, 0.48, 0.5]} />
          <meshStandardMaterial color={['#c94f3d', '#2f7bbf', '#d9a43a', '#3f9c6a'][i % 4]} />
        </mesh>
      ))}
      <mesh position={[7, 0.5, 8.5]}>
        <boxGeometry args={[6, 0.8, 1.4]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
    </>
  );
}

function CameraRig({ resetKey, zoom, controls }: { resetKey: number; zoom: number; controls: React.RefObject<any> }) {
  const { camera, invalidate } = useThree();
  useEffect(() => {
    // zoom < 1 moves the camera closer; keyboard-accessible alternative to wheel/pinch
    camera.position.set(15 * zoom, 15 * zoom, 18 * zoom);
    camera.lookAt(0, 0, -1);
    controls.current?.target.set(0, 0, -1);
    controls.current?.update();
    invalidate();
  }, [resetKey, zoom, camera, controls, invalidate]);
  return null;
}

export default function Campus3D({ sites, selected, onSelect, zoom, resetKey }: { sites: CampusSite[]; selected: string | null; onSelect: (id: string | null) => void; zoom: number; resetKey: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const controls = useRef<any>(null);
  return (
    <Canvas frameloop="demand" camera={{ position: [15, 15, 18], fov: 38 }} dpr={[1, 1.75]} onPointerMissed={() => onSelect(null)} gl={{ antialias: true, powerPreference: 'low-power' }} style={{ height: '100%', minHeight: 420, flex: 1 }}>
      <color attach="background" args={['#14456b']} />
      <fog attach="fog" args={['#14456b', 35, 70]} />
      <hemisphereLight args={['#dfefff', '#2b4a2f', 0.9]} />
      <directionalLight position={[10, 18, 8]} intensity={1.3} />
      <Ground />
      <Trees />
      {sites.map((s) => (
        <Building key={s.id} site={s} selected={selected === s.id} hovered={hover === s.id} onHover={setHover} onSelect={onSelect} />
      ))}
      <OrbitControls ref={controls} enablePan={false} minPolarAngle={0.5} maxPolarAngle={1.2} minDistance={14} maxDistance={36} enableDamping={false} />
      <CameraRig resetKey={resetKey} zoom={zoom} controls={controls} />
    </Canvas>
  );
}

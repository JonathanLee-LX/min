import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ROAD_LENGTH, TrafficSim } from './sim';

const LANE_W = 4.0;
const CAR_W = 1.9;
const VISIBLE_LENGTH = 240; // metres of road shown on screen

const COL_GREEN = new THREE.Color(0x35e46a);
const COL_YELLOW = new THREE.Color(0xffd23f);
const COL_RED = new THREE.Color(0xff3b30);

interface CarView {
  group: THREE.Group;
  bodyMat: THREE.MeshStandardMaterial;
  tailMat: THREE.MeshBasicMaterial;
  trail: THREE.Line;
  trailPts: THREE.Vector3[];
  arrow: THREE.Line;
  arrowPos: THREE.BufferAttribute;
}

export class SceneView {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;

  paused = false;
  timeScale = 1;
  showTrails = true;
  showVectors = true;
  onStats?: (s: ReturnType<TrafficSim['stats']>) => void;

  private carViews: CarView[] = [];
  private paceView!: CarView;
  private roadGroup = new THREE.Group();
  private markerGroup = new THREE.Group();
  private anchor = 0;
  private clock = new THREE.Clock();
  private sun!: THREE.DirectionalLight;

  private readonly bodyGeo = new THREE.BoxGeometry(CAR_W, 0.7, 1);
  private readonly cabinGeo = new THREE.BoxGeometry(CAR_W * 0.82, 0.5, 1);

  constructor(container: HTMLElement, private sim: TrafficSim) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x070a12);
    this.scene.fog = new THREE.Fog(0x070a12, 110, 210);

    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 1200);
    this.camera.position.set(30, 62, 40);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 220;

    this.buildLights();
    this.buildGround();
    this.buildRoad();
    this.rebuildCars();
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0x9fb6ff, 0x0a0d16, 0.85));

    this.sun = new THREE.DirectionalLight(0xffffff, 1.7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const d = 55;
    const cam = this.sun.shadow.camera;
    cam.left = -d;
    cam.right = d;
    cam.top = d;
    cam.bottom = -d;
    cam.near = 1;
    cam.far = 260;
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    const rim = new THREE.DirectionalLight(0x4da3ff, 0.6);
    rim.position.set(40, 25, -70);
    this.scene.add(rim);
  }

  private buildGround(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(700, 700),
      new THREE.MeshStandardMaterial({ color: 0x0b111d, roughness: 0.95 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(700, 140, 0x1b2740, 0x121b2c);
    const gm = grid.material as THREE.Material;
    gm.transparent = true;
    gm.opacity = 0.5;
    grid.position.y = -0.01;
    this.scene.add(grid);
  }

  private buildRoad(): void {
    // This group slides in Z so the road always fills the view while the
    // camera stays put.
    this.scene.add(this.roadGroup);

    const roadHalf = (VISIBLE_LENGTH * 2) / 2 + 40;
    const asphalt = new THREE.Mesh(
      new THREE.PlaneGeometry(LANE_W + 1.6, roadHalf * 2),
      new THREE.MeshStandardMaterial({ color: 0x1d212a, roughness: 0.88 })
    );
    asphalt.rotation.x = -Math.PI / 2;
    asphalt.receiveShadow = true;
    this.roadGroup.add(asphalt);

    for (const x of [-(LANE_W + 1.6) / 2 + 0.2, (LANE_W + 1.6) / 2 - 0.2]) {
      const line = new THREE.Mesh(
        new THREE.PlaneGeometry(0.16, roadHalf * 2),
        new THREE.MeshBasicMaterial({ color: 0xcfd6e2 })
      );
      line.rotation.x = -Math.PI / 2;
      line.position.set(x, 0.012, 0);
      this.roadGroup.add(line);
    }

    // Dashed centre guide + repeater posts (repositioned every frame).
    this.scene.add(this.markerGroup);
    const dashMat = new THREE.MeshBasicMaterial({ color: 0x39445a });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x2a3446, roughness: 0.7 });
    const postGeo = new THREE.BoxGeometry(0.22, 1.5, 0.22);
    const dashGeo = new THREE.PlaneGeometry(0.1, 3.0);
    for (let d = -VISIBLE_LENGTH / 2 - 20; d <= VISIBLE_LENGTH / 2 + 20; d += 8) {
      const dash = new THREE.Mesh(dashGeo, dashMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(0, 0.012, d);
      this.markerGroup.add(dash);
      dash.userData.baseZ = d;
    }
    for (let d = -VISIBLE_LENGTH / 2 - 20; d <= VISIBLE_LENGTH / 2 + 20; d += 20) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(-(LANE_W + 1.6) / 2 - 1.2, 0.75, d);
      post.castShadow = true;
      this.markerGroup.add(post);
      post.userData.baseZ = d;
    }
  }

  private makeCarView(pace: boolean): CarView {
    const group = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({
      color: pace ? 0x9aa6bd : 0x35e46a,
      roughness: 0.38,
      metalness: 0.35,
    });
    const body = new THREE.Mesh(this.bodyGeo, bodyMat);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const cabin = new THREE.Mesh(
      this.cabinGeo,
      new THREE.MeshStandardMaterial({ color: 0x0f131b, roughness: 0.15, metalness: 0.7 })
    );
    cabin.position.set(0, 0.58, -0.1);
    group.add(cabin);

    const tailMat = new THREE.MeshBasicMaterial({ color: 0x3a0a08 });
    const tail = new THREE.Mesh(new THREE.BoxGeometry(CAR_W * 0.82, 0.16, 0.1), tailMat);
    tail.position.set(0, 0.08, 0.5 + 0.02);
    group.add(tail);

    this.scene.add(group);

    const trail = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.5 })
    );
    trail.frustumCulled = false;
    trail.visible = false;
    this.scene.add(trail);

    const arrowGeoRef = new THREE.BufferGeometry();
    arrowGeoRef.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const arrow = new THREE.Line(
      arrowGeoRef,
      new THREE.LineBasicMaterial({ color: 0x4da3ff, transparent: true, opacity: 0.8 })
    );
    arrow.frustumCulled = false;
    this.scene.add(arrow);

    return {
      group,
      bodyMat,
      tailMat,
      trail,
      trailPts: [],
      arrow,
      arrowPos: arrowGeoRef.getAttribute('position') as THREE.BufferAttribute,
    };
  }

  /** Rebuild meshes after reset / density change. */
  rebuildCars(): void {
    for (const v of this.carViews) this.disposeView(v);
    if (this.paceView) this.disposeView(this.paceView);
    this.paceView = this.makeCarView(true);
    this.carViews = this.sim.cars.slice(1).map(() => this.makeCarView(false));
    this.anchor = this.sim.cars[0].s;
  }

  private disposeView(v: CarView): void {
    this.scene.remove(v.group, v.trail, v.arrow);
    v.group.traverse((o: THREE.Object3D) => {
      const m = o as THREE.Mesh;
      if (m.geometry && m.geometry !== this.bodyGeo && m.geometry !== this.cabinGeo) m.geometry.dispose();
    });
    v.bodyMat.dispose();
    v.tailMat.dispose();
    v.trail.geometry.dispose();
    (v.trail.material as THREE.Material).dispose();
    v.arrow.geometry.dispose();
    (v.arrow.material as THREE.Material).dispose();
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  start(): void {
    const tick = () => {
      requestAnimationFrame(tick);
      const rawDt = Math.min(this.clock.getDelta(), 0.05);
      if (!this.paused) this.sim.step(rawDt * this.timeScale);
      this.updateVisuals(rawDt);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  private wrapDelta(d: number): number {
    if (d > ROAD_LENGTH / 2) return d - ROAD_LENGTH;
    if (d < -ROAD_LENGTH / 2) return d + ROAD_LENGTH;
    return d;
  }

  private updateVisuals(dt: number): void {
    const cars = this.sim.cars;

    // Anchor on the middle of the pack so the jam stays framed.
    const target = cars[Math.max(1, Math.floor(cars.length / 2))].s;
    const k = this.paused ? 0 : 1 - Math.exp(-dt * 2.0);
    this.anchor = ((this.anchor + this.wrapDelta(target - this.anchor) * k) % ROAD_LENGTH + ROAD_LENGTH) % ROAD_LENGTH;

    const zFor = (s: number) => this.wrapDelta(s - this.anchor);

    // Slide road / markers with the anchor.
    this.roadGroup.position.z = -this.wrapDelta(this.anchor);
    for (const child of this.markerGroup.children) {
      child.position.z = -this.wrapDelta(this.anchor) + (child.userData.baseZ as number);
    }

    // Shadow camera follows the visible stretch.
    this.sun.position.set(-35, 85, 30);
    this.sun.target.position.set(0, 0, 0);

    const tmp = new THREE.Color();

    const updateOne = (v: CarView, idx: number) => {
      const car = cars[idx];
      const z = zFor(car.s);
      const visible = Math.abs(z) < VISIBLE_LENGTH * 0.75;
      v.group.visible = visible;
      v.group.position.set(0, 0.42, z);
      const isPace = idx === 0;

      if (!isPace) {
        const brake = car.brakeLight; // 0..1
        const speedFrac = Math.min(1, car.v / this.sim.v0);
        tmp.copy(COL_GREEN).lerp(COL_YELLOW, Math.min(1, brake * 1.5));
        if (brake > 0.6) tmp.lerp(COL_RED, Math.min(1, (brake - 0.6) / 0.35));
        tmp.multiplyScalar(0.5 + 0.5 * speedFrac);
        v.bodyMat.color.copy(tmp);

        const glow = brake;
        v.tailMat.color.setRGB(0.23 + 0.77 * glow, 0.04 + 0.06 * glow, 0.03 + 0.02 * glow);

        // Brake trail
        if (this.showTrails && visible && brake > 0.2) {
          v.trailPts.push(new THREE.Vector3(0, 0.1, z + 2.2));
          if (v.trailPts.length > 60) v.trailPts.shift();
          v.trail.geometry.dispose();
          v.trail.geometry = new THREE.BufferGeometry().setFromPoints(v.trailPts);
          v.trail.visible = true;
          (v.trail.material as THREE.LineBasicMaterial).opacity = Math.min(0.75, 0.2 + brake * 0.6);
        } else {
          v.trail.visible = false;
          if (v.trailPts.length) v.trailPts.length = 0;
        }

        // Speed arrow
        if (this.showVectors && visible) {
          v.arrow.visible = true;
          const len = Math.min(14, car.v * 0.4);
          v.arrowPos.setXYZ(0, 0, 1.3, z);
          v.arrowPos.setXYZ(1, 0, 1.3, z + len);
          v.arrowPos.needsUpdate = true;
          v.arrow.geometry.computeBoundingSphere();
          const frac = Math.min(1, car.v / this.sim.v0);
          (v.arrow.material as THREE.LineBasicMaterial).color.setRGB(1 - 0.7 * frac, 0.3 + 0.6 * frac, 1.0);
        } else {
          v.arrow.visible = false;
        }
      } else {
        // Pace car flashes red when braking
        const braking = this.sim.time < car.brakeUntil;
        v.bodyMat.color.set(braking ? 0xff3b30 : 0x9aa6bd);
        v.tailMat.color.set(braking ? 0xff2200 : 0x331008);
        v.arrow.visible = false;
        v.trail.visible = false;
      }
    };

    updateOne(this.paceView!, 0);
    for (let i = 0; i < this.carViews.length; i++) updateOne(this.carViews[i], i + 1);

    this.onStats?.(this.sim.stats());
  }
}

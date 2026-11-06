import * as THREE from 'three';

/** MOBA camera: fixed 55° pitch, 38° FOV (Art Bible §3), follow/free modes, clamped to the arena. */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly target = new THREE.Vector3();
  locked = true;
  distance = 36;
  minDist = 24; maxDist = 50;
  private pitch = THREE.MathUtils.degToRad(55);
  private follow = new THREE.Vector3();
  constructor(private bounds: number) {
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 600);
  }
  setFollow(p: THREE.Vector3) { this.follow.copy(p); }
  pan(dx: number, dz: number) { this.locked = false; this.target.x += dx; this.target.z += dz; }
  zoom(delta: number) { this.distance = THREE.MathUtils.clamp(this.distance + delta, this.minDist, this.maxDist); }
  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    // Portrait phones: widen vertical FOV so the horizontal view stays playable.
    this.camera.fov = w < h ? 58 : 38;
    this.camera.updateProjectionMatrix();
  }
  update(dt: number) {
    if (this.locked) this.target.lerp(this.follow, 1 - Math.exp(-dt * 10));
    const b = this.bounds;
    this.target.x = THREE.MathUtils.clamp(this.target.x, -b, b);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -b, b);
    const off = new THREE.Vector3(0, Math.sin(this.pitch) * this.distance, Math.cos(this.pitch) * this.distance);
    this.camera.position.copy(this.target).add(off);
    this.camera.lookAt(this.target);
  }
}

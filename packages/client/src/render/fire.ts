import * as THREE from 'three';

const fireUniforms = { uTime: { value: 0 } };
let fireMat: THREE.ShaderMaterial | null = null;

/** Procedural flame: camera-facing quad, noise-distorted teardrop with a heat colour ramp, additive. */
export function fireMaterial(): THREE.ShaderMaterial {
  if (fireMat) return fireMat;
  fireMat = new THREE.ShaderMaterial({
    uniforms: fireUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vUv; varying float vSeed;
      void main(){
        vUv = uv;
        vec3 c = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vSeed = fract(sin(dot(c.xz, vec2(12.9898, 78.233))) * 43758.5453);
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 scale = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), 1.0);
        vec3 wp = c + right * position.x * scale.x + vec3(0.0, 1.0, 0.0) * position.y * scale.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: `uniform float uTime; varying vec2 vUv; varying float vSeed;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main(){
        vec2 p = vUv; float t = uTime * 2.2 + vSeed * 10.0;
        float nn = n(vec2(p.x * 4.0, p.y * 3.0 - t * 1.6)) * 0.6 + n(vec2(p.x * 9.0, p.y * 7.0 - t * 3.0)) * 0.4;
        float x = (p.x - 0.5) * 2.0;
        float shape = 1.0 - smoothstep(0.0, 1.0, abs(x) / (0.75 * (1.0 - p.y) * (0.55 + nn * 0.6) + 0.02));
        float body = shape * (1.0 - smoothstep(0.25, 1.0, p.y + nn * 0.35)) * smoothstep(0.0, 0.08, p.y);
        vec3 col = mix(vec3(1.0, 0.25, 0.04), vec3(1.0, 0.75, 0.32), body);
        col = mix(col, vec3(1.0, 0.95, 0.8), smoothstep(0.75, 1.0, body));
        gl_FragColor = vec4(col * body * 2.2, body);
      }`,
  });
  return fireMat;
}

export function makeFire(size = 1): THREE.Mesh {
  const g = new THREE.PlaneGeometry(1, 1.6); g.translate(0, 0.8, 0);
  const m = new THREE.Mesh(g, fireMaterial());
  m.scale.setScalar(size);
  m.frustumCulled = false;
  m.renderOrder = 5;
  return m;
}

export function updateFire(t: number) { fireUniforms.uTime.value = t; }

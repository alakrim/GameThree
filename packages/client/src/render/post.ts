import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/** Colour grade (cool shadows / warm highlights, gentle contrast) + vignette — Art Bible §5. Runs after tone mapping. */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVig: { value: 0.32 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 shadowTint = vec3(0.92, 0.97, 1.06), highTint = vec3(1.05, 1.0, 0.93);
      c.rgb *= mix(shadowTint, highTint, smoothstep(0.15, 0.75, l));
      c.rgb = mix(vec3(l), c.rgb, 0.92);                     // slight desaturation: weathered, not candy
      c.rgb = (c.rgb - 0.5) * 1.06 + 0.5;
      vec2 d = vUv - 0.5; c.rgb *= 1.0 - uVig * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
      gl_FragColor = c;
    }`,
};

export function createComposer(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, bloom: boolean) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (bloom) composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), 0.32, 0.55, 0.92)); // only fire/runes cross the threshold
  composer.addPass(new OutputPass());
  composer.addPass(new ShaderPass(GradeShader));
  return composer;
}

/**
 * Sky.ts — Gradient sky sphere for the Minecraft Clone Phase 6.
 *
 * This class renders a large sphere with a custom ShaderMaterial that
 * produces a beautiful gradient sky. The sky color smoothly transitions
 * through 4 key colors based on the time of day:
 *
 * - Midnight (0.00): Deep night blue (#0A0A2E)
 * - Dawn (0.25): Soft pale blue (#B0C4DE)
 * - Noon (0.50): Bright sky blue (#87CEEB)
 * - Dusk (0.75): Warm orange-red (#FF7F50)
 *
 * The shader also applies a vertical gradient: the horizon uses the
 * interpolated sky color, while the zenith is a deeper, darker version
 * of the same color for a more realistic and immersive sky.
 *
 * ## Rendering Details
 *
 * - The sphere has a radius of 500 units and uses `side: BackSide` so
 *   the inside of the sphere is visible from the camera.
 * - `depthWrite: false` prevents the sky from writing to the depth
 *   buffer, ensuring terrain and other objects render on top.
 * - `frustumCulled: false` ensures the sphere is always rendered even
 *   when the camera is positioned inside it.
 * - The sphere follows the camera position each frame via
 *   `update(cameraPosition)`, so the camera never exits the sphere.
 *
 * ## Usage
 *
 * ```typescript
 * const sky = new Sky(scene);
 *
 * // In the game loop:
 * sky.update(dayNightCycle.timeOfDay);
 * sky.update(camera.position);
 *
 * // Sync fog color:
 * scene.fog.color.copy(sky.getSkyColor());
 *
 * // Cleanup:
 * sky.dispose();
 * ```
 */
import * as THREE from 'three';

/**
 * Sky — Gradient sky sphere with day/night color transitions.
 *
 * Renders a large BackSide sphere with a custom GLSL shader that
 * interpolates between 4 key colors based on the time of day, with
 * an additional vertical gradient for a more realistic appearance.
 */
export class Sky {
  /** Radius of the sky sphere in world units */
  private static readonly SPHERE_RADIUS: number = 500;

  /** Number of width/height segments for the sphere geometry */
  private static readonly SPHERE_SEGMENTS: number = 32;

  /** Daytime sky color — bright blue */
  private static readonly DAY_COLOR: THREE.Color = new THREE.Color(0x87ceeb);

  /** Dusk sky color — warm orange-red */
  private static readonly DUSK_COLOR: THREE.Color = new THREE.Color(0xff7f50);

  /** Night sky color — deep dark blue */
  private static readonly NIGHT_COLOR: THREE.Color = new THREE.Color(0x0a0a2e);

  /** Dawn sky color — soft pale blue */
  private static readonly DAWN_COLOR: THREE.Color = new THREE.Color(0xb0c4de);

  /** Factor to darken the zenith color relative to the horizon color */
  private static readonly ZENITH_DARKEN_FACTOR: number = 0.6;

  /** The sky sphere mesh */
  private _mesh: THREE.Mesh;

  /** The custom shader material for the sky */
  private _material: THREE.ShaderMaterial;

  /** The sphere geometry */
  private _geometry: THREE.SphereGeometry;

  /** Current time of day, normalized to [0, 1] */
  private _timeOfDay: number;

  /** Current interpolated sky color (used for fog color sync) */
  private _skyColor: THREE.Color;

  /**
   * Creates a new Sky instance and adds it to the scene.
   *
   * The sky sphere is created with a custom ShaderMaterial that
   * interpolates between 4 key colors based on the time of day.
   * The sphere is centered at the origin initially — call
   * `update(cameraPosition)` each frame to keep it centered on
   * the camera.
   *
   * @param scene - The THREE.Scene to add the sky sphere to.
   */
  constructor(scene: THREE.Scene) {
    this._timeOfDay = 0.25; // Start at dawn
    this._skyColor = new THREE.Color();

    // Create the sphere geometry.
    // 32 segments is sufficient for a smooth sphere at this scale.
    this._geometry = new THREE.SphereGeometry(
      Sky.SPHERE_RADIUS,
      Sky.SPHERE_SEGMENTS,
      Sky.SPHERE_SEGMENTS
    );

    // Create the shader material with uniforms for the 4 key colors
    // and the current time of day.
    this._material = new THREE.ShaderMaterial({
      uniforms: {
        uTimeOfDay: { value: this._timeOfDay },
        uDayColor: { value: Sky.DAY_COLOR.clone() },
        uDuskColor: { value: Sky.DUSK_COLOR.clone() },
        uNightColor: { value: Sky.NIGHT_COLOR.clone() },
        uDawnColor: { value: Sky.DAWN_COLOR.clone() }
      },
      vertexShader: `
        varying vec3 vWorldPosition;

        void main() {
          // Pass the world position to the fragment shader.
          // We use the model matrix to get the world position of the vertex.
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;

          // Standard projection.
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform float uTimeOfDay;
        uniform vec3 uDayColor;
        uniform vec3 uDuskColor;
        uniform vec3 uNightColor;
        uniform vec3 uDawnColor;

        varying vec3 vWorldPosition;

        /**
         * Smoothstep interpolation function.
         * Clamps the input to [0, 1] and applies Hermite interpolation.
         */
        float smoothstepCustom(float edge0, float edge1, float x) {
          float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
          return t * t * (3.0 - 2.0 * t);
        }

        /**
         * Interpolates between two colors with a smoothstep curve.
         */
        vec3 mixSmooth(vec3 colorA, vec3 colorB, float t) {
          return mix(colorA, colorB, smoothstepCustom(0.0, 1.0, t));
        }

        /**
         * Computes the sky color for a given time of day.
         *
         * The time of day is normalized to [0, 1]:
         *   0.00 = midnight
         *   0.25 = dawn
         *   0.50 = noon
         *   0.75 = dusk
         *
         * The color is interpolated between the 4 key colors using
         * smoothstep transitions to avoid any color jumps.
         */
        vec3 getSkyColor(float timeOfDay) {
          // Handle the wrap-around case: [0.75, 1.0] → dusk to night,
          // then [0.0, 0.25] → night to dawn.
          // We split into two segments for clarity.

          // Segment 1: [0.75, 1.0] — dusk to night
          if (timeOfDay >= 0.75) {
            float t = (timeOfDay - 0.75) / 0.25; // 0 at dusk, 1 at midnight
            return mixSmooth(uDuskColor, uNightColor, t);
          }

          // Segment 2: [0.0, 0.25] — night to dawn
          if (timeOfDay < 0.25) {
            float t = timeOfDay / 0.25; // 0 at midnight, 1 at dawn
            return mixSmooth(uNightColor, uDawnColor, t);
          }

          // Segment 3: [0.25, 0.5] — dawn to day
          if (timeOfDay < 0.5) {
            float t = (timeOfDay - 0.25) / 0.25; // 0 at dawn, 1 at noon
            return mixSmooth(uDawnColor, uDayColor, t);
          }

          // Segment 4: [0.5, 0.75] — day to dusk
          // (timeOfDay >= 0.5 && timeOfDay < 0.75)
          float t = (timeOfDay - 0.5) / 0.25; // 0 at noon, 1 at dusk
          return mixSmooth(uDayColor, uDuskColor, t);
        }

        void main() {
          // Compute the base sky color from the time of day.
          vec3 horizonColor = getSkyColor(uTimeOfDay);

          // Compute the vertical gradient factor based on the height
          // of the fragment relative to the horizon.
          // Normalize the world position to get the direction from the
          // sphere center (which is the camera position).
          vec3 direction = normalize(vWorldPosition);
          float height = direction.y; // -1 (below) to 1 (above)

          // For the upper hemisphere (above horizon):
          //   - At the horizon (height = 0): use the horizon color
          //   - At the zenith (height = 1): use a darker version
          float upperMix = smoothstepCustom(0.0, 0.4, max(height, 0.0));
          vec3 zenithColor = horizonColor * ${Sky.ZENITH_DARKEN_FACTOR.toFixed(2)};
          vec3 upperColor = mix(horizonColor, zenithColor, upperMix);

                              // For the lower hemisphere (below horizon):
          //   - Use the exact horizon color so the sky below the horizon
          //     perfectly matches the fog color, eliminating any visible
          //     seam where terrain fades into fog.
          float lowerMix = smoothstepCustom(0.0, -0.2, min(height, 0.0));
          vec3 groundColor = horizonColor;
          vec3 lowerColor = mix(horizonColor, groundColor, lowerMix);

          // Combine: use upper color for height >= 0, lower color for height < 0.
          vec3 finalColor = height >= 0.0 ? upperColor : lowerColor;

          gl_FragColor = vec4(finalColor, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false
    });

    // Create the mesh and add it to the scene.
    this._mesh = new THREE.Mesh(this._geometry, this._material);
    this._mesh.frustumCulled = false; // Always render, even when camera is inside
    this._mesh.renderOrder = -1000; // Render first (behind everything)
    scene.add(this._mesh);

    // Initialize the CPU-side sky color for fog sync.
    this._computeSkyColor();
  }

  /**
   * Gets the current time of day.
   *
   * @returns The normalized time of day in [0, 1].
   *         0 = midnight, 0.25 = dawn, 0.5 = noon, 0.75 = dusk.
   */
  public get timeOfDay(): number {
    return this._timeOfDay;
  }

  /**
   * Updates the sky with the current time of day.
   *
   * This updates the shader uniform and recomputes the CPU-side
   * sky color used for fog color synchronization.
   *
   * @param timeOfDay - The normalized time of day in [0, 1].
   *                   Values outside [0, 1] are clamped.
   */
  public update(timeOfDay: number): void {
    // Clamp to [0, 1] to handle edge cases.
    this._timeOfDay = Math.max(0, Math.min(1, timeOfDay));

    // Update the shader uniform.
    this._material.uniforms.uTimeOfDay.value = this._timeOfDay;

    // Recompute the CPU-side sky color for fog sync.
    this._computeSkyColor();
  }

  /**
   * Updates the sky sphere position to follow the camera.
   *
   * The sky sphere must always be centered on the camera so the
   * camera never exits the sphere. Call this every frame with the
   * current camera position.
   *
   * @param cameraPosition - The current camera position in world space.
   */
  public updateCameraPosition(cameraPosition: THREE.Vector3): void {
    // Copy the position (not reference) to avoid external mutation.
    this._mesh.position.copy(cameraPosition);
  }

  /**
   * Gets the current interpolated sky color.
   *
   * This is the horizon color at the current time of day, computed
   * on the CPU using the same interpolation logic as the shader.
   * Use this to synchronize the fog color with the sky.
   *
   * @returns A THREE.Color representing the current sky color.
   *          The returned color is a reference — copy it if you
   *          need to keep it after the next update.
   */
  public getSkyColor(): THREE.Color {
    return this._skyColor;
  }

  /**
   * Disposes of all GPU resources held by the sky.
   *
   * Removes the mesh from the scene and disposes the geometry and
   * material. Call this when the sky is no longer needed (e.g.,
   * when restarting the game or unloading the scene).
   */
  public dispose(): void {
    // Remove the mesh from its parent (scene).
    if (this._mesh.parent) {
      this._mesh.parent.remove(this._mesh);
    }

    // Dispose the geometry.
    this._geometry.dispose();

    // Dispose the material — this releases the shader program.
    this._material.dispose();
  }

  /**
   * Computes the current sky color on the CPU.
   *
   * This mirrors the shader's color interpolation logic so the
   * fog color can be synchronized with the sky. The result is
   * stored in `_skyColor`.
   */
  private _computeSkyColor(): void {
    const t = this._timeOfDay;
    const result = this._skyColor;

    // Handle the wrap-around case: [0.75, 1.0] → dusk to night,
    // then [0.0, 0.25] → night to dawn.
    if (t >= 0.75) {
      // Dusk to night: [0.75, 1.0]
      const progress = (t - 0.75) / 0.25;
      result.copy(Sky.DUSK_COLOR).lerp(Sky.NIGHT_COLOR, Sky._smoothstep(progress));
    } else if (t < 0.25) {
      // Night to dawn: [0.0, 0.25]
      const progress = t / 0.25;
      result.copy(Sky.NIGHT_COLOR).lerp(Sky.DAWN_COLOR, Sky._smoothstep(progress));
    } else if (t < 0.5) {
      // Dawn to day: [0.25, 0.5]
      const progress = (t - 0.25) / 0.25;
      result.copy(Sky.DAWN_COLOR).lerp(Sky.DAY_COLOR, Sky._smoothstep(progress));
    } else {
      // Day to dusk: [0.5, 0.75]
      const progress = (t - 0.5) / 0.25;
      result.copy(Sky.DAY_COLOR).lerp(Sky.DUSK_COLOR, Sky._smoothstep(progress));
    }
  }

  /**
   * Smoothstep interpolation function.
   *
   * Applies Hermite interpolation to the input value, producing a
   * smooth S-curve transition from 0 to 1. The input is clamped
   * to [0, 1].
   *
   * @param t - Input value, typically in [0, 1].
   * @returns Smoothly interpolated value in [0, 1].
   */
  private static _smoothstep(t: number): number {
    const x = Math.max(0, Math.min(1, t));
    return x * x * (3 - 2 * x);
  }
}
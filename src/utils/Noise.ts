/**
 * Noise.ts — Seeded Simplex noise implementation (2D and 3D) with FBM support.
 *
 * This module provides a self-contained implementation of Simplex noise,
 * a gradient-based noise algorithm that produces natural-looking, continuous
 * pseudo-random values. Unlike Perlin noise, Simplex noise has:
 * - Lower computational complexity (O(n²) vs O(2ⁿ) for n dimensions)
 * - No directional artifacts (less axis-aligned bias)
 * - Well-defined gradients at integer lattice points
 *
 * The implementation follows the classic Stefan Gustavson algorithm,
 * which is public domain. It uses a seeded permutation table to ensure
 * deterministic output — the same seed always produces the same noise field,
 * while different seeds produce completely different fields.
 *
 * FBM (Fractal Brownian Motion) layers multiple octaves of noise with
 * increasing frequency and decreasing amplitude to create natural-looking
 * terrain with both large-scale features and fine detail.
 */

/** 2D skewing factor: (√3 - 1) / 2 */
const F2 = 0.5 * (Math.sqrt(3) - 1);
/** 2D unskewing factor: (3 - √3) / 6 */
const G2 = (3 - Math.sqrt(3)) / 6;

/** 3D skewing factor: 1/3 */
const F3 = 1 / 3;
/** 3D unskewing factor: 1/6 */
const G3 = 1 / 6;

/** Gradient vectors for 2D noise (8 directions, evenly spaced) */
const GRAD_2D: ReadonlyArray<readonly [number, number]> = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

/** Gradient vectors for 3D noise (12 directions, evenly distributed on a sphere) */
const GRAD_3D: ReadonlyArray<readonly [number, number, number]> = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

/**
 * Deterministic pseudo-random number generator (mulberry32).
 * Produces a sequence of 32-bit floats in [0, 1) from a 32-bit seed.
 * Used to shuffle the permutation table deterministically.
 *
 * @param seed - 32-bit integer seed.
 * @returns A function that returns the next pseudo-random float in [0, 1).
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0; // Ensure unsigned 32-bit
  return function (): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * SimplexNoise — Seeded Simplex noise generator with FBM support.
 *
 * Create an instance with a seed number. The same seed always produces
 * the same noise field, enabling deterministic world generation.
 *
 * Example:
 * ```ts
 * const noise = new SimplexNoise(42);
 * const height = noise.fbm2D(x * 0.01, z * 0.01, 4, 2.0, 0.5);
 * ```
 */
export class SimplexNoise {
  /** Permutation table (512 bytes) — doubled to avoid index wrapping */
  private readonly perm: Uint8Array;

  /**
   * Creates a new SimplexNoise instance with the given seed.
   *
   * @param seed - Integer seed for deterministic noise generation.
   *               Different seeds produce different noise fields.
   *               If omitted or 0, a random seed is used.
   */
  constructor(seed: number = 0) {
    // If seed is 0 or invalid, generate a random one
    if (!Number.isFinite(seed) || seed === 0) {
      seed = SimplexNoise.createRandomSeed();
    }

    // Build the base permutation table (0-255)
    const basePerm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      basePerm[i] = i;
    }

    // Fisher-Yates shuffle using the seeded PRNG
    const rand = mulberry32(seed);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [basePerm[i], basePerm[j]] = [basePerm[j], basePerm[i]];
    }

    // Double the table to avoid index wrapping in noise calculations
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = basePerm[i & 255];
    }
  }

  /**
   * Generates a random 32-bit seed.
   *
   * @returns A random integer seed suitable for SimplexNoise.
   */
  public static createRandomSeed(): number {
    return Math.floor(Math.random() * 0xffffffff);
  }

  /**
   * Computes 2D Simplex noise at the given coordinates.
   *
   * The algorithm works by:
   * 1. Skewing the input coordinates onto a triangular grid
   * 2. Determining which simplex (triangle) the point falls into
   * 3. Computing the contribution of each corner's gradient
   * 4. Summing contributions with a radial falloff function
   *
   * @param x - X coordinate in noise space.
   * @param y - Y coordinate in noise space.
   * @returns Noise value in the range [-1, 1].
   */
  public noise2D(x: number, y: number): number {
    // Skew the input space to determine which simplex cell we're in
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);

    // Unskew the cell origin back to (x, y) space
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);

    // Determine which simplex (triangle) we're in
    // Offsets for the second corner of the simplex
    let i1: number, j1: number;
    if (x0 > y0) {
      // Lower triangle: (1, 0) offset
      i1 = 1;
      j1 = 0;
    } else {
      // Upper triangle: (0, 1) offset
      i1 = 0;
      j1 = 1;
    }

    // Coordinates of the second and third corners
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    // Hash the corner coordinates to get gradient indices
    const ii = i & 255;
    const jj = j & 255;
    const gi0 = this.perm[ii + this.perm[jj]] % 8;
    const gi1 = this.perm[ii + i1 + this.perm[jj + j1]] % 8;
    const gi2 = this.perm[ii + 1 + this.perm[jj + 1]] % 8;

    // Calculate the contribution of each corner
    let n0 = 0, n1 = 0, n2 = 0;

    // Corner 0 (origin)
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      t0 *= t0;
      n0 = t0 * t0 * this.dot2D(gi0, x0, y0);
    }

    // Corner 1
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      t1 *= t1;
      n1 = t1 * t1 * this.dot2D(gi1, x1, y1);
    }

    // Corner 2
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      t2 *= t2;
      n2 = t2 * t2 * this.dot2D(gi2, x2, y2);
    }

    // Sum and normalize to [-1, 1]
    return 70.0 * (n0 + n1 + n2);
  }

  /**
   * Computes 3D Simplex noise at the given coordinates.
   *
   * The algorithm extends the 2D version to 3D by:
   * 1. Skewing onto a tetrahedral grid
   * 2. Determining which tetrahedron the point falls into
   * 3. Computing contributions from all 4 corners
   *
   * @param x - X coordinate in noise space.
   * @param y - Y coordinate in noise space.
   * @param z - Z coordinate in noise space.
   * @returns Noise value in the range [-1, 1].
   */
  public noise3D(x: number, y: number, z: number): number {
    // Skew the input space to determine which simplex cell we're in
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);

    // Unskew the cell origin back to (x, y, z) space
    const t = (i + j + k) * G3;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const z0 = z - (k - t);

    // Determine which simplex (tetrahedron) we're in
    let i1: number, j1: number, k1: number;
    let i2: number, j2: number, k2: number;

    if (x0 >= y0) {
      if (y0 >= z0) {
        // (1, 0, 0) then (1, 1, 0)
        i1 = 1; j1 = 0; k1 = 0;
        i2 = 1; j2 = 1; k2 = 0;
      } else if (x0 >= z0) {
        // (1, 0, 0) then (1, 0, 1)
        i1 = 1; j1 = 0; k1 = 0;
        i2 = 1; j2 = 0; k2 = 1;
      } else {
        // (0, 0, 1) then (1, 0, 1)
        i1 = 0; j1 = 0; k1 = 1;
        i2 = 1; j2 = 0; k2 = 1;
      }
    } else {
      if (y0 < z0) {
        // (0, 0, 1) then (0, 1, 1)
        i1 = 0; j1 = 0; k1 = 1;
        i2 = 0; j2 = 1; k2 = 1;
      } else if (x0 < z0) {
        // (0, 1, 0) then (0, 1, 1)
        i1 = 0; j1 = 1; k1 = 0;
        i2 = 0; j2 = 1; k2 = 1;
      } else {
        // (0, 1, 0) then (1, 1, 0)
        i1 = 0; j1 = 1; k1 = 0;
        i2 = 1; j2 = 1; k2 = 0;
      }
    }

    // Coordinates of the four corners
    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3;
    const y2 = y0 - j2 + 2 * G3;
    const z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3;
    const y3 = y0 - 1 + 3 * G3;
    const z3 = z0 - 1 + 3 * G3;

    // Hash the corner coordinates to get gradient indices
    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;
    const gi0 = this.perm[ii + this.perm[jj + this.perm[kk]]] % 12;
    const gi1 = this.perm[ii + i1 + this.perm[jj + j1 + this.perm[kk + k1]]] % 12;
    const gi2 = this.perm[ii + i2 + this.perm[jj + j2 + this.perm[kk + k2]]] % 12;
    const gi3 = this.perm[ii + 1 + this.perm[jj + 1 + this.perm[kk + 1]]] % 12;

    // Calculate the contribution of each corner
    let n0 = 0, n1 = 0, n2 = 0, n3 = 0;

    // Corner 0 (origin)
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) {
      t0 *= t0;
      n0 = t0 * t0 * this.dot3D(gi0, x0, y0, z0);
    }

    // Corner 1
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) {
      t1 *= t1;
      n1 = t1 * t1 * this.dot3D(gi1, x1, y1, z1);
    }

    // Corner 2
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) {
      t2 *= t2;
      n2 = t2 * t2 * this.dot3D(gi2, x2, y2, z2);
    }

    // Corner 3
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) {
      t3 *= t3;
      n3 = t3 * t3 * this.dot3D(gi3, x3, y3, z3);
    }

    // Sum and normalize to [-1, 1]
    return 32.0 * (n0 + n1 + n2 + n3);
  }

  /**
   * Computes Fractal Brownian Motion (FBM) using 2D noise.
   *
   * FBM layers multiple octaves of noise:
   * - Each octave doubles the frequency (lacunarity = 2.0)
   * - Each octave halves the amplitude (gain = 0.5)
   * - The result is the weighted sum of all octaves
   *
   * This produces natural-looking terrain with both large-scale
   * features (low octaves) and fine detail (high octaves).
   *
   * @param x - X coordinate in noise space.
   * @param y - Y coordinate in noise space.
   * @param octaves - Number of noise layers to sum (default: 4).
   *                  Higher values add more detail but cost more computation.
   * @param lacunarity - Frequency multiplier between octaves (default: 2.0).
   * @param gain - Amplitude multiplier between octaves (default: 0.5).
   * @returns Noise value in the range [-1, 1].
   */
  public fbm2D(
    x: number,
    y: number,
    octaves: number = 4,
    lacunarity: number = 2.0,
    gain: number = 0.5
  ): number {
    // Clamp octaves to a reasonable range to prevent excessive computation
    const clampedOctaves = Math.max(1, Math.min(8, Math.floor(octaves)));

    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxAmplitude = 0; // Used for normalization

    for (let i = 0; i < clampedOctaves; i++) {
      value += this.noise2D(x * frequency, y * frequency) * amplitude;
      maxAmplitude += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }

    // Normalize to [-1, 1] to maintain consistent output range
    return value / maxAmplitude;
  }

  /**
   * Computes Fractal Brownian Motion (FBM) using 3D noise.
   *
   * Useful for volumetric features like tree placement, cave systems,
   * or ore distribution where vertical variation matters.
   *
   * @param x - X coordinate in noise space.
   * @param y - Y coordinate in noise space.
   * @param z - Z coordinate in noise space.
   * @param octaves - Number of noise layers to sum (default: 4).
   * @param lacunarity - Frequency multiplier between octaves (default: 2.0).
   * @param gain - Amplitude multiplier between octaves (default: 0.5).
   * @returns Noise value in the range [-1, 1].
   */
  public fbm3D(
    x: number,
    y: number,
    z: number,
    octaves: number = 4,
    lacunarity: number = 2.0,
    gain: number = 0.5
  ): number {
    // Clamp octaves to a reasonable range
    const clampedOctaves = Math.max(1, Math.min(8, Math.floor(octaves)));

    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxAmplitude = 0;

    for (let i = 0; i < clampedOctaves; i++) {
      value += this.noise3D(x * frequency, y * frequency, z * frequency) * amplitude;
      maxAmplitude += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }

    return value / maxAmplitude;
  }

  /**
   * Computes the dot product of a 2D gradient with a vector.
   *
   * @param index - Gradient index (0-7) into the 2D gradient table.
   * @param x - X component of the vector.
   * @param y - Y component of the vector.
   * @returns The dot product value.
   */
  private dot2D(index: number, x: number, y: number): number {
    const grad = GRAD_2D[index];
    return grad[0] * x + grad[1] * y;
  }

  /**
   * Computes the dot product of a 3D gradient with a vector.
   *
   * @param index - Gradient index (0-11) into the 3D gradient table.
   * @param x - X component of the vector.
   * @param y - Y component of the vector.
   * @param z - Z component of the vector.
   * @returns The dot product value.
   */
  private dot3D(index: number, x: number, y: number, z: number): number {
    const grad = GRAD_3D[index];
    return grad[0] * x + grad[1] * y + grad[2] * z;
  }
}

/**
 * Creates a new SimplexNoise instance with the given seed.
 *
 * This is a convenience factory function for quick instantiation.
 *
 * @param seed - Integer seed for deterministic noise generation.
 *               If omitted or 0, a random seed is used.
 * @returns A configured SimplexNoise instance.
 *
 * @example
 * ```ts
 * const noise = createNoise(12345);
 * const value = noise.noise2D(0.5, 0.5);
 * ```
 */
export function createNoise(seed?: number): SimplexNoise {
  return new SimplexNoise(seed);
}

// Default export for convenient importing
export default SimplexNoise;
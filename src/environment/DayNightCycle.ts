/**
 * DayNightCycle.ts — Game time system for the Minecraft Clone Phase 6.
 *
 * This class manages the game's day/night cycle with a 10-minute (600 second)
 * full cycle. It tracks the time of day as a normalized value (0-1) and
 * provides methods to query the sun's elevation angle and light intensity
 * factors for smooth day/night transitions.
 *
 * ## Time Conventions
 *
 * - `timeOfDay` is normalized to [0, 1]:
 *   - 0.00 = midnight
 *   - 0.25 = dawn (sunrise)
 *   - 0.50 = noon
 *   - 0.75 = dusk (sunset)
 *   - 1.00 = midnight (wraps to 0)
 *
 * - The cycle starts at dawn (0.25) so the player experiences a pleasant
 *   sunrise when the game begins.
 *
 * - `getSunAngle()` returns the sun's elevation angle in radians:
 *   - 0 at dawn (sun on the horizon, rising)
 *   - π/2 at noon (sun directly overhead)
 *   - π at dusk (sun on the horizon, setting)
 *   - 3π/2 at midnight (sun directly below)
 *
 * ## Light Factors
 *
 * - `getDaylightFactor()` returns a smooth 0-1 value indicating daylight
 *   intensity. It is 1.0 during full day, 0.0 during full night, with
 *   smooth transitions at dawn and dusk.
 *
 * - `getNightFactor()` is the inverse of `getDaylightFactor()`.
 *
 * ## Usage
 *
 * ```typescript
 * const dayNightCycle = new DayNightCycle();
 *
 * // In the game loop:
 * dayNightCycle.update(deltaTime);
 * const sunAngle = dayNightCycle.getSunAngle();
 * const daylight = dayNightCycle.getDaylightFactor();
 * ```
 */
export class DayNightCycle {
  /** Duration of a full day/night cycle in seconds (10 minutes) */
  public static readonly CYCLE_DURATION: number = 600;

  /** Initial time of day — dawn (sunrise) for a pleasant start */
  public static readonly INITIAL_TIME: number = 0.25;

  /** Dawn transition window: time range where daylight ramps up */
  private static readonly DAWN_START: number = 0.25;
  private static readonly DAWN_END: number = 0.35;

  /** Dusk transition window: time range where daylight ramps down */
  private static readonly DUSK_START: number = 0.65;
  private static readonly DUSK_END: number = 0.75;

  /**
   * The current time of day, normalized to [0, 1].
   * 0 = midnight, 0.25 = dawn, 0.5 = noon, 0.75 = dusk.
   */
  private _timeOfDay: number;

  /**
   * Creates a new DayNightCycle instance.
   *
   * The cycle starts at dawn (0.25) so the player experiences a sunrise
   * when the game begins.
   */
  constructor() {
    this._timeOfDay = DayNightCycle.INITIAL_TIME;
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
   * Advances the game time by the given delta time.
   *
   * The time wraps around at 1.0 back to 0.0, completing one full
   * day/night cycle every `CYCLE_DURATION` (600) seconds.
   *
   * @param deltaTime - Time elapsed since the last frame, in seconds.
   *                   Must be non-negative. Negative values are clamped to 0.
   */
  public update(deltaTime: number): void {
    // Clamp negative delta times to prevent time from going backwards.
    const safeDelta = Math.max(0, deltaTime);

    // Advance time and wrap around at 1.0.
    this._timeOfDay = (this._timeOfDay + safeDelta / DayNightCycle.CYCLE_DURATION) % 1.0;
  }

  /**
   * Gets the sun's elevation angle in radians.
   *
   * The angle is measured from the horizon:
   * - 0 at dawn (sun on the horizon, rising)
   * - π/2 at noon (sun directly overhead)
   * - π at dusk (sun on the horizon, setting)
   * - 3π/2 at midnight (sun directly below the horizon)
   *
   * This angle can be used to position a directional light in the scene:
   *
   * ```typescript
   * const angle = dayNightCycle.getSunAngle();
   * sunLight.position.set(
   *   Math.cos(angle) * 100,
   *   Math.sin(angle) * 100,
   *   0
   * );
   * ```
   *
   * @returns The sun's elevation angle in radians.
   */
  public getSunAngle(): number {
    // Offset by 0.25 so that:
    //   timeOfDay 0.25 (dawn)  → angle 0
    //   timeOfDay 0.50 (noon)  → angle π/2
    //   timeOfDay 0.75 (dusk)  → angle π
    //   timeOfDay 0.00 (midnight) → angle 3π/2
    return (this._timeOfDay - 0.25) * Math.PI * 2;
  }

  /**
   * Gets the daylight intensity factor.
   *
   * Returns a smooth value in [0, 1]:
   * - 1.0 during full day (between dawn end and dusk start)
   * - 0.0 during full night (between dusk end and dawn start)
   * - Smoothly transitions between 0 and 1 during dawn and dusk windows.
   *
   * This factor can be used to scale sun light intensity:
   *
   * ```typescript
   * sunLight.intensity = dayNightCycle.getDaylightFactor() * 1.0;
   * ```
   *
   * @returns The daylight factor in [0, 1].
   */
  public getDaylightFactor(): number {
    const t = this._timeOfDay;

    // During the day (between dawn end and dusk start), full daylight.
    if (t >= DayNightCycle.DAWN_END && t <= DayNightCycle.DUSK_START) {
      return 1.0;
    }

    // During the night (between dusk end and dawn start, wrapping past 1.0),
    // no daylight.
    if (t >= DayNightCycle.DUSK_END || t <= DayNightCycle.DAWN_START) {
      return 0.0;
    }

    // Dawn transition: ramp up from 0 to 1.
    if (t > DayNightCycle.DAWN_START && t < DayNightCycle.DAWN_END) {
      const progress = (t - DayNightCycle.DAWN_START) / (DayNightCycle.DAWN_END - DayNightCycle.DAWN_START);
      return DayNightCycle.smoothstep(progress);
    }

    // Dusk transition: ramp down from 1 to 0.
    // (t > DUSK_START && t < DUSK_END)
    const progress = (t - DayNightCycle.DUSK_START) / (DayNightCycle.DUSK_END - DayNightCycle.DUSK_START);
    return 1.0 - DayNightCycle.smoothstep(progress);
  }

  /**
   * Gets the night intensity factor.
   *
   * This is the inverse of `getDaylightFactor()`:
   * - 1.0 during full night
   * - 0.0 during full day
   * - Smoothly transitions between 0 and 1 during dawn and dusk.
   *
   * This factor can be used to scale moon light intensity:
   *
   * ```typescript
   * moonLight.intensity = dayNightCycle.getNightFactor() * 0.3;
   * ```
   *
   * @returns The night factor in [0, 1].
   */
  public getNightFactor(): number {
    return 1.0 - this.getDaylightFactor();
  }

  /**
   * Resets the day/night cycle to its initial state (dawn).
   *
   * This is useful when restarting the game or respawning the player.
   */
  public reset(): void {
    this._timeOfDay = DayNightCycle.INITIAL_TIME;
  }

  /**
   * Smoothstep interpolation function.
   *
   * Applies Hermite interpolation to the input value, producing a smooth
   * S-curve transition from 0 to 1. The input is clamped to [0, 1].
   *
   * @param t - Input value, typically in [0, 1].
   * @returns Smoothly interpolated value in [0, 1].
   */
  private static smoothstep(t: number): number {
    // Clamp input to [0, 1] to handle edge cases.
    const x = Math.max(0, Math.min(1, t));
    // Hermite interpolation: 3t² - 2t³
    return x * x * (3 - 2 * x);
  }
}
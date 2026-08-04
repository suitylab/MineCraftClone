/**
 * Game.ts — Central game orchestrator for the Minecraft Clone Phase 7.
 *
 * This module initializes the Three.js rendering pipeline and wires together
 * the world generation, chunk mesh rendering, first-person player controls,
 * physics systems, and the new state machine driven game flow.
 *
 * ## Phase 7 Changes
 *
 * - **State Machine**: The game now uses a GameStateManager to track states
 *   (MENU, LOADING, PLAYING, PAUSED, CONTROLS, ABOUT). The main loop checks
 *   the current state and updates only relevant systems.
 * - **Menu Background Scene**: A separate THREE.Scene with slowly rotating
 *   blocks provides the atmospheric background for the main menu, controls,
 *   and about screens.
 * - **Loading Sequence**: World generation is synchronous, so a simulated
 *   progress animation (0→100% over ~1.5s) provides a smooth loading
 *   experience before the world is actually generated.
 * - **UI Screens**: MainMenu, PauseMenu, LoadingScreen, ControlsScreen, and
 *   AboutScreen are created and wired via callbacks.
 * - **World Reset**: WorldReset orchestrates the complete world regeneration
 *   when the player clicks "重新开始" (Restart) in the pause menu.
 * - **Pointer Lock Management**: Pointer lock is requested when entering
 *   PLAYING and released when entering PAUSED or MENU.
 *
 * ## Initialization Flow
 *
 * 1. Scene is created with dark background (menu state).
 * 2. Camera is created with a 75° FOV.
 * 3. Renderer is created and appended to the mount element.
 * 4. Lighting is set up (ambient + sun + moon).
 * 5. DayNightCycle and Sky are created.
 * 6. World is created and `generateWorld()` is called.
 * 7. ChunkMesh is created with the world's ChunkManager.
 * 8. Input is created with the renderer's canvas element.
 * 9. Player is created with the world and a spawn position.
 * 10. BlockHighlight, ParticleSystem, and Hotbar are created.
 * 11. All UI screens are created.
 * 12. Menu background scene is created.
 * 13. WorldReset is created.
 * 14. UI callbacks are wired.
 * 15. ESC handler is registered.
 * 16. Game starts in MENU state with the main menu shown.
 */
import * as THREE from 'three';
import { World, BlockType } from '../world/World';
import { ChunkMesh } from '../world/ChunkMesh';
import { Player } from '../player/Player';
import { Input } from './Input';
import { VoxelRaycaster, RaycastResult } from '../interaction/Raycaster';
import { BlockHighlight } from '../interaction/BlockHighlight';
import { ParticleSystem } from '../effects/ParticleSystem';
import { Hotbar } from '../ui/Hotbar';
import { DayNightCycle } from '../environment/DayNightCycle';
import { Sky } from '../environment/Sky';
import { GameState, GameStateManager } from './GameState';
import { MainMenu } from '../ui/MainMenu';
import { PauseMenu } from '../ui/PauseMenu';
import { LoadingScreen } from '../ui/LoadingScreen';
import { ControlsScreen } from '../ui/ControlsScreen';
import { AboutScreen } from '../ui/AboutScreen';
import { WorldReset } from './WorldReset';
import { TextureGenerator } from '../textures/TextureGenerator';
import { CrackOverlay } from '../effects/CrackOverlay';
import { CameraTransition } from '../effects/CameraTransition';

/** Duration of the simulated loading progress animation in seconds. */
const LOADING_DURATION = 1.5;

/** Number of blocks in the menu background scene. */
const MENU_BLOCK_COUNT = 7;

/** Radius of the circle on which menu blocks are arranged. */
const MENU_BLOCK_RADIUS = 4;

/** Height of the menu blocks above the origin. */
const MENU_BLOCK_HEIGHT = 0;

/** Menu camera orbit radius. */
const MENU_CAMERA_RADIUS = 10;

/** Menu camera orbit speed in radians per second. */
const MENU_CAMERA_SPEED = 0.15;

/** Menu camera height above the origin. */
const MENU_CAMERA_HEIGHT = 3;

/** Menu camera field of view in degrees. */
const MENU_CAMERA_FOV = 60;

/**
 * Game — Central game orchestrator.
 *
 * Responsible for:
 * - Initializing the Three.js rendering pipeline (Scene, Camera, Renderer)
 * - Setting up lighting (ambient + directional sun/moon lights)
 * - Creating the World (procedural terrain) and building its mesh
 * - Creating the Input system (keyboard, mouse, Pointer Lock)
 * - Creating the Player entity (first-person controls, physics, collision)
 * - Managing game states via GameStateManager
 * - Creating and wiring all UI screens (main menu, pause menu, loading, etc.)
 * - Creating the menu background scene with rotating blocks
 * - Running the main requestAnimationFrame loop with state-driven updates
 * - Handling window resize and full resource disposal
 */
export class Game {
  // --- Core Three.js objects ---
  /** The DOM element that the renderer canvas is appended to */
  public mountElement: HTMLElement;
  /** The root scene graph node containing all game 3D objects */
  public scene: THREE.Scene;
  /** The perspective camera used for rendering the game scene */
  public camera: THREE.PerspectiveCamera;
  /** The WebGL renderer responsible for drawing the scene */
  public renderer: THREE.WebGLRenderer;
  /** The world containing all block data */
  public world: World;
  /** The chunk mesh renderer that converts block data into merged geometries */
  public chunkMesh: ChunkMesh;
  /** The input system handling keyboard, mouse, and Pointer Lock */
  public input: Input;
  /** The player entity with first-person controls and physics */
  public player: Player;
  /** Clock for measuring delta time between frames */
  public clock: THREE.Clock;
  /** Frame counter for FPS logging */
  public frameCount: number;
  /** The ID of the current animation frame request (for cancellation) */
  public animationId: number | null;
  /** Whether the game loop is currently running */
  public isRunning: boolean;
  /** The block highlight for the targeted block */
  public blockHighlight: BlockHighlight;
  /** The particle system for block break effects */
  public particleSystem: ParticleSystem;
    /** The last raycast hit result */
  public _lastRaycastHit: RaycastResult | null;
  /** The crack overlay for block break animation */
  public crackOverlay: CrackOverlay;
  /** The camera transition for smooth descent on game start */
  public cameraTransition: CameraTransition;
  /** Pending block break awaiting crack animation completion */
  private _pendingBreak: { x: number; y: number; z: number; blockType: BlockType } | null;
  /** Whether the camera is currently transitioning */
  private _isCameraTransitioning: boolean;
  /** The hotbar UI for selecting block types to place */
  public hotbar: Hotbar;
  /** The day/night cycle system managing game time */
  public dayNightCycle: DayNightCycle;
  /** The gradient sky sphere renderer */
  public sky: Sky;
  /** The directional light simulating the sun */
  public sunLight: THREE.DirectionalLight;
  /** The directional light simulating the moon */
  public moonLight: THREE.DirectionalLight;
  /** The ambient light providing base illumination */
  public ambientLight: THREE.AmbientLight;

  // --- Phase 7: State Machine ---
  /** The game state manager tracking the current state */
  public stateManager: GameStateManager;

  // --- Phase 7: UI Screens ---
  /** The main menu overlay */
  public mainMenu: MainMenu;
  /** The pause menu overlay */
  public pauseMenu: PauseMenu;
  /** The loading screen overlay */
  public loadingScreen: LoadingScreen;
  /** The controls screen overlay */
  public controlsScreen: ControlsScreen;
  /** The about screen overlay */
  public aboutScreen: AboutScreen;

  // --- Phase 7: Menu Background Scene ---
  /** The separate scene for the menu background */
  public menuScene: THREE.Scene;
  /** The camera for the menu background scene */
  public menuCamera: THREE.PerspectiveCamera;
  /** The group containing the rotating menu blocks */
  public menuGroup: THREE.Group;
  /** The menu camera orbit angle in radians */
  public menuCameraAngle: number;

  // --- Phase 7: World Reset ---
  /** The world reset orchestrator */
  public worldReset: WorldReset;

  // --- Phase 7: Loading Progress ---
  /** The current loading progress value (0-1) */
  public loadingProgress: number;
  /** The timestamp when the loading animation started */
  public loadingStartTime: number;
  /** Whether the loading animation is currently active */
  public isLoading: boolean;
  /** Whether the current loading is for a world restart */
  public isLoadingRestart: boolean;

  /**
   * Creates a new Game instance.
   *
   * All properties are initialized to null/0/false. Call `init()` to
   * set up the rendering pipeline, world, input, player, UI screens,
   * and menu background scene, then `start()` to begin the main loop.
   *
   * @param mountElement - The DOM element to attach the renderer canvas to.
   */
  constructor(mountElement: HTMLElement) {
    this.mountElement = mountElement;
    this.scene = null as unknown as THREE.Scene;
    this.camera = null as unknown as THREE.PerspectiveCamera;
    this.renderer = null as unknown as THREE.WebGLRenderer;
    this.world = null as unknown as World;
    this.chunkMesh = null as unknown as ChunkMesh;
    this.input = null as unknown as Input;
    this.player = null as unknown as Player;
    this.clock = new THREE.Clock();
    this.frameCount = 0;
    this.animationId = null;
    this.isRunning = false;
    this.blockHighlight = null as unknown as BlockHighlight;
    this.particleSystem = null as unknown as ParticleSystem;
        this._lastRaycastHit = null;
    this.crackOverlay = null as unknown as CrackOverlay;
    this.cameraTransition = null as unknown as CameraTransition;
    this._pendingBreak = null;
    this._isCameraTransitioning = false;
    this.hotbar = null as unknown as Hotbar;
    this.dayNightCycle = null as unknown as DayNightCycle;
    this.sky = null as unknown as Sky;
    this.sunLight = null as unknown as THREE.DirectionalLight;
    this.moonLight = null as unknown as THREE.DirectionalLight;
    this.ambientLight = null as unknown as THREE.AmbientLight;

    // Phase 7: State machine
    this.stateManager = new GameStateManager();

    // Phase 7: UI screens
    this.mainMenu = null as unknown as MainMenu;
    this.pauseMenu = null as unknown as PauseMenu;
    this.loadingScreen = null as unknown as LoadingScreen;
    this.controlsScreen = null as unknown as ControlsScreen;
    this.aboutScreen = null as unknown as AboutScreen;

    // Phase 7: Menu background scene
    this.menuScene = null as unknown as THREE.Scene;
    this.menuCamera = null as unknown as THREE.PerspectiveCamera;
    this.menuGroup = null as unknown as THREE.Group;
    this.menuCameraAngle = 0;

    // Phase 7: World reset
    this.worldReset = null as unknown as WorldReset;

    // Phase 7: Loading progress
    this.loadingProgress = 0;
    this.loadingStartTime = 0;
    this.isLoading = false;
    this.isLoadingRestart = false;
  }

  /**
   * Initializes the entire game: scene, camera, renderer, lights, world,
   * mesh, input, player, UI screens, menu background scene, and WorldReset.
   * Must be called before start().
   *
   * The initialization sequence is:
   * 1. Scene setup (dark background for menu state)
   * 2. Camera setup (perspective camera with 75° FOV)
   * 3. Renderer setup (antialiased WebGL renderer)
   * 4. Lighting setup (ambient + sun + moon)
   * 5. DayNightCycle and Sky setup
   * 6. World creation and generation (128×128 procedural terrain)
   * 7. ChunkMesh creation (merged geometry per chunk)
   * 8. Input creation (keyboard, mouse, Pointer Lock)
   * 9. Player creation (first-person controls, physics, collision)
   * 10. BlockHighlight, ParticleSystem, and Hotbar creation
   * 11. UI screen creation (main menu, pause menu, loading, controls, about)
   * 12. Menu background scene creation (rotating blocks)
   * 13. WorldReset creation
   * 14. UI callback wiring
   * 15. ESC handler registration
   * 16. Initial state: MENU with main menu shown
   */
  public init(): void {
    // --- Scene Setup ---
    // Dark background for the initial MENU state. The background will be
    // updated to the sky color when entering PLAYING state.
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);
    this.scene.fog = new THREE.Fog(0x87ceeb, 50, 85);

    // --- Camera Setup ---
    // Perspective camera with a 75° FOV, aspect ratio from the mount element.
    const aspect = this.mountElement.clientWidth / this.mountElement.clientHeight;
    this.camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);

    // --- Renderer Setup ---
    // WebGL renderer with antialiasing for smoother edges.
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(this.mountElement.clientWidth, this.mountElement.clientHeight);
    this.mountElement.appendChild(this.renderer.domElement);

    // --- Lighting Setup ---
    // Ambient light provides base illumination so nothing is pitch black.
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(this.ambientLight);

    // Main directional light simulating the sun with a warm color.
    this.sunLight = new THREE.DirectionalLight(0xfff5e6, 1.0);
    this.sunLight.position.set(50, 100, 30);
    this.scene.add(this.sunLight);

    // Moon directional light with a cool color.
    this.moonLight = new THREE.DirectionalLight(0x9bb8ff, 0.0);
    this.moonLight.position.set(-50, -100, -30);
    this.scene.add(this.moonLight);

    // --- Day/Night Cycle & Sky Setup ---
    this.dayNightCycle = new DayNightCycle();
    this.sky = new Sky(this.scene);

        // --- World Creation ---
    // Create a new World (empty — terrain is generated during LOADING state).
    this.world = new World();

    // --- Input System ---
    this.input = new Input(this.renderer.domElement);

    // --- Phase 4: Block Interaction Setup ---
    this.blockHighlight = new BlockHighlight(this.scene);
        this.particleSystem = new ParticleSystem(this.scene);
    this.crackOverlay = new CrackOverlay(this.scene);
    this.cameraTransition = new CameraTransition(this.camera);
    this._pendingBreak = null;
    this._isCameraTransitioning = false;
    this.hotbar = new Hotbar();

        // Register input click handlers for block break/place.
    this.input.setLeftClickHandler(() => this._handleLeftClick());
    this.input.setRightClickHandler(() => this._handleRightClick());

    // --- Phase 7: UI Screen Creation ---
    this._createUIScreens();

    // --- Phase 7: Menu Background Scene ---
    this._createMenuScene();

        // --- Phase 7: Wire UI Callbacks ---
    this._wireUICallbacks();

    // --- Phase 7: ESC Key Handling ---
    this._registerEscapeHandler();

    // --- Phase 7: Initial State ---
    // Start in MENU state: show main menu, hide game HUD.
    this._enterMenuState();

    // --- Resize Handling ---
    window.addEventListener('resize', this.onResize);
  }

  /**
   * Starts the game loop. Must be called after init().
   *
   * If the game is already running, a warning is logged and the method
   * returns without effect. This prevents duplicate animation loops.
   */
  public start(): void {
        if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    this.clock.start();
    this.animate();
  }

  /**
   * Stops the game loop and cancels any pending animation frames.
   *
   * This is safe to call even if the game is not running — the
   * animationId check prevents errors from canceling a non-existent frame.
   */
  public stop(): void {
    this.isRunning = false;
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  /**
   * The main game loop. Requests the next frame, computes delta time,
   * updates game logic based on the current state, and renders the
   * appropriate scene.
   *
   * This method is called recursively via requestAnimationFrame. It
   * checks `isRunning` at the start to gracefully stop when `stop()`
   * is called.
   */
  private animate(): void {
    if (!this.isRunning) {
      return;
    }
    this.animationId = requestAnimationFrame(this.animate.bind(this));
    const deltaTime = this.clock.getDelta();
    this.update(deltaTime);
    this.render();
  }

  /**
   * Updates game logic each frame based on the current game state.
   *
   * State-driven update logic:
   * - PLAYING: Updates player physics, day/night cycle, sky, lighting,
   *   raycast, block highlight, particles, and FPS logging.
   * - PAUSED: No updates — the scene is rendered as a static frame.
   * - MENU/CONTROLS/ABOUT: Updates the menu background scene (rotating
   *   blocks and orbiting camera).
   * - LOADING: Updates the loading progress animation.
   *
   * @param deltaTime - Time in seconds since the last frame.
   */
  private update(deltaTime: number): void {
    const state = this.stateManager.getCurrentState();

    switch (state) {
      case GameState.PLAYING:
        this._updatePlaying(deltaTime);
        break;

      case GameState.PAUSED:
        // No updates — the scene is rendered as a static frame.
        break;

      case GameState.MENU:
      case GameState.CONTROLS:
      case GameState.ABOUT:
        this._updateMenuScene(deltaTime);
        break;

      case GameState.LOADING:
        this._updateLoading(deltaTime);
        break;
    }
  }

  /**
   * Updates the game systems during the PLAYING state.
   *
   * This includes:
   * - Day/night cycle and sky updates
   * - Sun/moon light positioning and intensity
   * - Fog and background color synchronization
   * - Player physics and camera synchronization
   * - Raycast for block targeting
   * - Block highlight update
   * - Particle system update
   * - FPS logging
   *
   * @param deltaTime - Time in seconds since the last frame.
   */
  private _updatePlaying(deltaTime: number): void {
    // --- Day/Night Cycle ---
    this.dayNightCycle.update(deltaTime);
    const timeOfDay = this.dayNightCycle.timeOfDay;

    // Update the sky shader with the current time of day.
    this.sky.update(timeOfDay);

    // Keep the sky sphere centered on the camera.
    this.sky.updateCameraPosition(this.camera.position);

    // Update the sun position based on its elevation angle.
    const sunAngle = this.dayNightCycle.getSunAngle();
    this.sunLight.position.set(
      Math.cos(sunAngle) * 100,
      Math.sin(sunAngle) * 100,
      0
    );

    // The moon is positioned opposite the sun.
    this.moonLight.position.set(
      Math.cos(sunAngle + Math.PI) * 100,
      Math.sin(sunAngle + Math.PI) * 100,
      0
    );

    // Update light intensities based on the day/night factors.
    const daylight = this.dayNightCycle.getDaylightFactor();
    this.sunLight.intensity = daylight * 1.0;
    this.moonLight.intensity = this.dayNightCycle.getNightFactor() * 0.3;

    // Ambient light smoothly interpolates between night (0.2) and day (0.5).
    this.ambientLight.intensity = 0.2 + daylight * 0.3;

    // Sync the fog color with the current sky color for a seamless horizon.
    this.scene.fog.color.copy(this.sky.getSkyColor());

    // Update the scene background to match the sky color.
    this.scene.background = this.sky.getSkyColor().clone();

        // --- Camera Transition ---
    // If the camera is transitioning (smooth descent on game start),
    // advance the transition and skip player movement/camera sync.
    if (this._isCameraTransitioning) {
      const transitionComplete = this.cameraTransition.update(deltaTime);
      if (transitionComplete) {
        this._isCameraTransitioning = false;
      }
    } else {
      // Update the player physics (movement, gravity, jumping, collision).
      this.player.update(deltaTime, this.input);

      // Synchronize the camera with the player's eye position.
      this.camera.position.copy(this.player.getEyePosition());

      // Synchronize the camera rotation with the player's yaw/pitch.
      this.camera.rotation.x = this.player.pitch;
      this.camera.rotation.y = this.player.yaw;
    }

        // --- Distance-Based Chunk Culling ---
    // Hide chunks whose horizontal center distance from the camera exceeds
    // the fog far plane (85 blocks). This improves rendering performance
    // on the expanded 512×512 world by reducing the number of visible chunks.
    this.chunkMesh.updateCulling(this.camera.position, 85);

    // --- Block Interaction ---
    // Cast a ray from the camera position in the camera's forward direction.
    const rayDirection = new THREE.Vector3();
    this.camera.getWorldDirection(rayDirection);
    this._lastRaycastHit = VoxelRaycaster.raycast(
      this.camera.position,
      rayDirection,
      8,
      (x: number, y: number, z: number) => this.world.getBlock(x, y, z)
    );

        // Update the block highlight based on the raycast result.
    this.blockHighlight.update(this._lastRaycastHit);

    // --- Crack Animation ---
    // If a block break is pending, advance the crack animation.
    if (this._pendingBreak) {
      const crackComplete = this.crackOverlay.update(deltaTime);
      if (crackComplete) {
        // The crack animation is complete — perform the actual break.
        const { x, y, z, blockType } = this._pendingBreak;

        // Spawn break particles at the hit block position.
        this.particleSystem.spawnBreakParticles(x, y, z, blockType);

        // Set the block to AIR (break it).
        this.world.setBlock(x, y, z, BlockType.AIR);

        // Reset the pending break and crack overlay.
        this._pendingBreak = null;
        this.crackOverlay.reset();
      }
    }

    // Update particle effects (gravity, movement, fade).
    this.particleSystem.update(deltaTime);
  }

  /**
   * Updates the menu background scene (rotating blocks and orbiting camera).
   *
   * The menu group rotates slowly around the Y axis, and the menu camera
   * orbits the group at a fixed radius and height.
   *
   * @param deltaTime - Time in seconds since the last frame.
   */
  private _updateMenuScene(deltaTime: number): void {
    // Rotate the menu group slowly around the Y axis.
    if (this.menuGroup) {
      this.menuGroup.rotation.y += deltaTime * 0.3;
    }

    // Orbit the menu camera around the group.
    this.menuCameraAngle += deltaTime * MENU_CAMERA_SPEED;
    this.menuCamera.position.x = Math.cos(this.menuCameraAngle) * MENU_CAMERA_RADIUS;
    this.menuCamera.position.z = Math.sin(this.menuCameraAngle) * MENU_CAMERA_RADIUS;
    this.menuCamera.position.y = MENU_CAMERA_HEIGHT;
    this.menuCamera.lookAt(0, MENU_BLOCK_HEIGHT, 0);
  }

  /**
   * Updates the loading progress animation.
   *
   * The loading progress is animated from 0 to 100% over LOADING_DURATION
   * seconds. When the animation completes, the world is generated (if this
   * is a restart) and the game transitions to PLAYING.
   *
   * @param deltaTime - Time in seconds since the last frame.
   */
  private _updateLoading(deltaTime: number): void {
    // Ignore deltaTime — use wall-clock time for accurate progress.
    const elapsed = (performance.now() - this.loadingStartTime) / 1000;
    this.loadingProgress = Math.min(1, elapsed / LOADING_DURATION);

    // Update the loading screen progress bar.
    this.loadingScreen.setProgress(this.loadingProgress);

    // When the animation completes, finish loading.
    if (this.loadingProgress >= 1) {
      this._finishLoading();
    }
  }

  /**
   * Renders the appropriate scene based on the current game state.
   *
   * - MENU/CONTROLS/ABOUT/LOADING: Renders the menu background scene.
   * - PLAYING/PAUSED: Renders the main game scene.
   */
  private render(): void {
    const state = this.stateManager.getCurrentState();

    if (state === GameState.MENU || state === GameState.CONTROLS ||
        state === GameState.ABOUT || state === GameState.LOADING) {
      // Render the menu background scene.
      this.renderer.render(this.menuScene, this.menuCamera);
    } else {
      // Render the main game scene (PLAYING or PAUSED).
      this.renderer.render(this.scene, this.camera);
    }
  }

  /**
   * Handles left-click: breaks the targeted block.
   *
   * If the raycast hit a block and it's not BEDROCK, spawns break particles
   * at the hit position and sets the block to AIR.
   */
    private _handleLeftClick(): void {
    // Ignore if no block is targeted.
    if (!this._lastRaycastHit) {
      return;
    }

    // Ignore if a crack animation is already in progress.
    if (this._pendingBreak) {
      return;
    }

    const hit = this._lastRaycastHit;

    // Bedrock is indestructible.
    if (hit.hitBlock === BlockType.BEDROCK) {
      return;
    }

    // Store the pending break and start the crack animation.
    this._pendingBreak = {
      x: hit.hitX,
      y: hit.hitY,
      z: hit.hitZ,
      blockType: hit.hitBlock,
    };
    this.crackOverlay.startBreaking(hit.hitX, hit.hitY, hit.hitZ, {
      x: hit.normalX,
      y: hit.normalY,
      z: hit.normalZ,
    });
  }

  /**
   * Handles right-click: places a block at the targeted block's adjacent face.
   *
   * Checks that the placement position is AIR or WATER and doesn't overlap
   * the player's collision body, then places the currently selected block
   * type from the hotbar.
   */
  private _handleRightClick(): void {
    // Ignore if no block is targeted.
    if (!this._lastRaycastHit) {
      return;
    }

    const hit = this._lastRaycastHit;
    const { placeX, placeY, placeZ } = hit;

    // The placement position must be AIR or WATER (replaceable).
    const targetBlock = this.world.getBlock(placeX, placeY, placeZ);
    if (targetBlock !== BlockType.AIR && targetBlock !== BlockType.WATER) {
      return;
    }

    // The placement position must not overlap the player's collision body.
    if (this._isPositionOverlappingPlayer(placeX, placeY, placeZ)) {
      return;
    }

    // Place the currently selected block type from the hotbar.
    const selectedType = this.hotbar.getSelectedBlockType();
    this.world.setBlock(placeX, placeY, placeZ, selectedType);
  }

  /**
   * Checks whether a block position overlaps the player's collision AABB.
   *
   * The player's AABB is centered horizontally on the player position and
   * extends vertically from feet (position.y) to head (position.y + height).
   * A block overlaps if its AABB [x, x+1] × [y, y+1] × [z, z+1] intersects
   * the player's AABB on all three axes.
   *
   * @param x - World X coordinate of the block.
   * @param y - World Y coordinate of the block.
   * @param z - World Z coordinate of the block.
   * @returns True if the block overlaps the player's collision body.
   */
  private _isPositionOverlappingPlayer(x: number, y: number, z: number): boolean {
    const p = this.player.position;
    const halfWidth = this.player.width / 2;
    const halfDepth = this.player.depth / 2;

    // Check overlap on each axis independently.
    const overlapX = x < p.x + halfWidth && x + 1 > p.x - halfWidth;
    const overlapY = y < p.y + this.player.height && y + 1 > p.y;
    const overlapZ = z < p.z + halfDepth && z + 1 > p.z - halfDepth;

    return overlapX && overlapY && overlapZ;
  }

  /**
   * Creates all UI screen overlays.
   *
   * This creates the main menu, pause menu, loading screen, controls screen,
   * and about screen. All screens are initially hidden.
   */
  private _createUIScreens(): void {
    this.mainMenu = new MainMenu();
    this.pauseMenu = new PauseMenu();
    this.loadingScreen = new LoadingScreen();
    this.controlsScreen = new ControlsScreen();
    this.aboutScreen = new AboutScreen();
  }

  /**
   * Creates the menu background scene with slowly rotating blocks.
   *
   * This creates a separate THREE.Scene with a group of floating blocks
   * arranged in a circle. Each block uses a procedural texture from
   * TextureGenerator. A separate camera orbits the group slowly.
   */
  private _createMenuScene(): void {
    // Create the menu scene with a dark background.
    this.menuScene = new THREE.Scene();
    this.menuScene.background = new THREE.Color(0x1a1a2e);

    // Add ambient light for the menu scene.
    const menuAmbient = new THREE.AmbientLight(0xffffff, 0.6);
    this.menuScene.add(menuAmbient);

    // Add a directional light for the menu scene.
    const menuLight = new THREE.DirectionalLight(0xffffff, 0.8);
    menuLight.position.set(5, 10, 7);
    this.menuScene.add(menuLight);

    // Create the group that will hold the rotating blocks.
    this.menuGroup = new THREE.Group();

    // The block types to display in the menu.
    const blockTypes = [
      BlockType.GRASS,
      BlockType.DIRT,
      BlockType.STONE,
      BlockType.SAND,
      BlockType.WOOD,
      BlockType.LEAVES,
      BlockType.WATER,
    ];

    // Create blocks arranged in a circle.
    for (let i = 0; i < MENU_BLOCK_COUNT; i++) {
      // Calculate the angle for this block.
      const angle = (i / MENU_BLOCK_COUNT) * Math.PI * 2;

      // Calculate the position on the circle.
      const x = Math.cos(angle) * MENU_BLOCK_RADIUS;
      const z = Math.sin(angle) * MENU_BLOCK_RADIUS;

      // Create the block mesh.
      const geometry = new THREE.BoxGeometry(1, 1, 1);

      // Get the procedural texture for this block type.
      const texture = TextureGenerator.getBlockTexture(blockTypes[i]);

      // Create the material with the texture.
      const material = new THREE.MeshLambertMaterial({ map: texture });

      // Create the mesh and position it.
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, MENU_BLOCK_HEIGHT, z);

      // Add a slight random rotation for visual variety.
      mesh.rotation.y = Math.random() * Math.PI;

      // Add the mesh to the group.
      this.menuGroup.add(mesh);
    }

    // Add the group to the menu scene.
    this.menuScene.add(this.menuGroup);

    // Create the menu camera.
    const aspect = this.mountElement.clientWidth / this.mountElement.clientHeight;
    this.menuCamera = new THREE.PerspectiveCamera(MENU_CAMERA_FOV, aspect, 0.1, 100);

    // Initialize the camera angle.
    this.menuCameraAngle = 0;

    // Position the camera initially.
    this.menuCamera.position.set(MENU_CAMERA_RADIUS, MENU_CAMERA_HEIGHT, 0);
    this.menuCamera.lookAt(0, MENU_BLOCK_HEIGHT, 0);
  }

  /**
   * Wires all UI screen callbacks to the game state machine.
   *
   * This connects the main menu, pause menu, controls screen, and about
   * screen buttons to the appropriate state transitions and game actions.
   */
  private _wireUICallbacks(): void {
    // --- Main Menu Callbacks ---
    this.mainMenu.setOnStartGame(() => {
      this._startLoading(false);
    });

    this.mainMenu.setOnControls(() => {
      this.stateManager.transition(GameState.CONTROLS);
      this.mainMenu.hide();
      this.controlsScreen.show();
    });

    this.mainMenu.setOnAbout(() => {
      this.stateManager.transition(GameState.ABOUT);
      this.mainMenu.hide();
      this.aboutScreen.show();
    });

    // --- Pause Menu Callbacks ---
        this.pauseMenu.setOnResume(() => {
      this.stateManager.transition(GameState.PLAYING);
      this.pauseMenu.hide();
      this._showGameHUD();
      this.input.setAllowPointerLockRequest(true);
      this.input.requestPointerLock();
    });

    this.pauseMenu.setOnRestart(() => {
      this._startLoading(true);
    });

        this.pauseMenu.setOnMainMenu(() => {
      this.stateManager.transition(GameState.MENU);
      this.pauseMenu.hide();
      this._enterMenuState();
      this.input.setAllowPointerLockRequest(false);
    });

    // --- Controls Screen Callbacks ---
    this.controlsScreen.setOnBack(() => {
      this.stateManager.transition(GameState.MENU);
      this.controlsScreen.hide();
      this.mainMenu.show();
    });

    // --- About Screen Callbacks ---
    this.aboutScreen.setOnBack(() => {
      this.stateManager.transition(GameState.MENU);
      this.aboutScreen.hide();
      this.mainMenu.show();
    });
  }

  /**
   * Registers the ESC key handler for pause/resume.
   *
   * The handler is invoked by the Input system when ESC is pressed:
   * - PLAYING → PAUSED: exit pointer lock, show pause menu, hide HUD
   * - PAUSED → PLAYING: request pointer lock, hide pause menu, show HUD
   */
  private _registerEscapeHandler(): void {
    // The Input class exposes an onEscape callback. We register a handler
    // that checks the current state and performs the appropriate action.
    // Since Input doesn't have a setEscapeHandler method yet, we use a
    // keydown listener on the document as a fallback.
    document.addEventListener('keydown', this._handleEscapeKey);
  }

  /**
   * Handles the ESC key press for pause/resume.
   *
   * @param event - The keyboard event.
   */
  private readonly _handleEscapeKey = (event: KeyboardEvent): void => {
    // Only handle ESC key.
    if (event.code !== 'Escape') {
      return;
    }

    const state = this.stateManager.getCurrentState();

    if (state === GameState.PLAYING) {
      // Pause the game.
      this.stateManager.transition(GameState.PAUSED);
            this.pauseMenu.show();
      this._hideGameHUD();
      this.input.exitPointerLock();
      this.input.setAllowPointerLockRequest(false);
    } else if (state === GameState.PAUSED) {
      // Resume the game.
      this.stateManager.transition(GameState.PLAYING);
            this.pauseMenu.hide();
      this._showGameHUD();
      this.input.setAllowPointerLockRequest(true);
      this.input.requestPointerLock();
    }
  };

  /**
   * Starts the loading sequence.
   *
   * This transitions to the LOADING state, shows the loading screen,
   * hides all other overlays, and starts the progress animation.
   *
   * @param isRestart - Whether this loading is for a world restart.
   */
  private _startLoading(isRestart: boolean): void {
    // Transition to LOADING state.
    this.stateManager.transition(GameState.LOADING);

    // Store whether this is a restart.
    this.isLoadingRestart = isRestart;

    // Show the loading screen.
    this.loadingScreen.show();

    // Hide all other overlays.
    this.mainMenu.hide();
    this.pauseMenu.hide();
    this.controlsScreen.hide();
    this.aboutScreen.hide();
    this._hideGameHUD();

        // Exit pointer lock if active.
    this.input.exitPointerLock();

    // Disable pointer lock requests during loading — the mouse must
    // remain visible so the player can interact with the loading screen.
    this.input.setAllowPointerLockRequest(false);

    // Reset the loading progress.
    this.loadingProgress = 0;
    this.loadingStartTime = performance.now();
    this.isLoading = true;

    // Set the loading screen to 0%.
    this.loadingScreen.setProgress(0);
  }

  /**
   * Finishes the loading sequence.
   *
   * This generates the world (if this is a restart), transitions to PLAYING,
   * hides the loading screen, shows the game HUD, and requests pointer lock.
   */
  private _finishLoading(): void {
    // Mark loading as complete.
    this.isLoading = false;

            // If this is a restart, regenerate the world.
    if (this.isLoadingRestart) {
      // Perform the world reset and update the chunk mesh reference.
      this.chunkMesh = this.worldReset.reset();

      // Reset the crack overlay and pending break for the new world.
      this.crackOverlay.reset();
      this._pendingBreak = null;
    } else {
      // Initial load: generate the world and set up game systems.
      this._setupInitialGameWorld();
    }

    // Transition to PLAYING state.
    this.stateManager.transition(GameState.PLAYING);

    // Hide the loading screen.
    this.loadingScreen.hide();

    // Show the game HUD (crosshair and hotbar).
    this._showGameHUD();

    // Start the camera transition: descend from 20 blocks above spawn
    // to the player's eye position over 1 second.
    const spawnPos = this.player.position.clone();
    const startPos = new THREE.Vector3(spawnPos.x, spawnPos.y + 20, spawnPos.z);
    const endPos = this.player.getEyePosition();
    this.cameraTransition.start(startPos, endPos);
    this._isCameraTransitioning = true;
    this.camera.position.copy(startPos);

    // Enable pointer lock requests — the player is now in the game
    // and clicking should lock the mouse for FPS controls.
    this.input.setAllowPointerLockRequest(true);

    // Request pointer lock for FPS controls.
    this.input.requestPointerLock();
  }

    /**
   * Sets up the game world for the initial load.
   *
   * This method is called from _finishLoading() when the loading animation
   * completes for the first time (not a restart). It generates the world,
   * creates the chunk mesh, player, and WorldReset orchestrator.
   *
   * Deferring world generation from init() to here ensures the main menu
   * appears immediately without a long freeze, since generating the 512×512
   * world is a heavy synchronous operation.
   */
  private _setupInitialGameWorld(): void {
    // Dispose any existing chunk mesh (from a previous session).
    if (this.chunkMesh) {
      this.chunkMesh.dispose();
      this.scene.remove(this.chunkMesh.group);
    }

    // Dispose the old world data and generate a fresh world.
    this.world.dispose();
    this.world.generateWorld();

    // Create the chunk mesh for the generated world.
    this.chunkMesh = new ChunkMesh(this.world.getChunkManager());
    this.scene.add(this.chunkMesh.group);

    // Create the player at the spawn position.
    const spawnPosition = new THREE.Vector3(0, 60, 0);
    this.player = new Player(this.world, spawnPosition);

    // Set the camera to the player's eye position.
    this.camera.position.copy(this.player.getEyePosition());
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.x = this.player.pitch;
    this.camera.rotation.y = this.player.yaw;

    // Register the chunk rebuild callback.
    this.world.setChunkRebuildCallback((chunkX: number, chunkY: number, chunkZ: number) => {
      const chunk = this.world.chunkManager.getChunk(chunkX, chunkY, chunkZ);
      if (chunk) {
        this.chunkMesh.buildChunk(chunk, this.world.chunkManager);
      }
    });

    // Create the WorldReset orchestrator for future restarts.
    this.worldReset = new WorldReset(
      this.world,
      this.chunkMesh,
      this.scene,
      this.player,
      this.dayNightCycle,
      this.hotbar,
      this.blockHighlight,
      this.particleSystem
    );
  }

  /**
   * Enters the MENU state.
   *
   * Shows the main menu, hides all other overlays, hides the game HUD,
   * exits pointer lock, and sets the scene background to the dark menu color.
   */
  private _enterMenuState(): void {
    // Show the main menu.
    this.mainMenu.show();

    // Hide all other overlays.
    this.pauseMenu.hide();
    this.loadingScreen.hide();
    this.controlsScreen.hide();
    this.aboutScreen.hide();

    // Hide the game HUD.
    this._hideGameHUD();

        // Exit pointer lock if active.
    this.input.exitPointerLock();

    // Disable pointer lock requests — the mouse must remain visible
    // in the main menu so the player can click menu buttons.
    this.input.setAllowPointerLockRequest(false);

    // Set the scene background to the dark menu color.
    this.scene.background = new THREE.Color(0x1a1a2e);
  }

  /**
   * Shows the game HUD elements (crosshair and hotbar).
   */
  private _showGameHUD(): void {
    const crosshair = document.getElementById('crosshair');
    if (crosshair) {
      crosshair.style.display = 'block';
    }

    const hotbar = document.getElementById('hotbar');
    if (hotbar) {
      hotbar.style.display = 'flex';
    }
  }

  /**
   * Hides the game HUD elements (crosshair and hotbar).
   */
  private _hideGameHUD(): void {
    const crosshair = document.getElementById('crosshair');
    if (crosshair) {
      crosshair.style.display = 'none';
    }

    const hotbar = document.getElementById('hotbar');
    if (hotbar) {
      hotbar.style.display = 'none';
    }
  }

  /**
   * Handles window resize events by updating the camera aspect ratio
   * and renderer size to match the mount element's new dimensions.
   *
   * If the mount element has zero dimensions (e.g., during layout),
   * the resize is skipped to avoid division by zero.
   */
  private onResize = (): void => {
    const width = this.mountElement.clientWidth;
    const height = this.mountElement.clientHeight;
    if (width === 0 || height === 0) {
      return;
    }

    // Update the main camera.
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    // Update the menu camera.
    if (this.menuCamera) {
      this.menuCamera.aspect = width / height;
      this.menuCamera.updateProjectionMatrix();
    }

    // Update the renderer size.
    this.renderer.setSize(width, height);
  };

  /**
   * Performs full cleanup: removes event listeners, stops the loop,
   * and disposes of all Three.js resources (renderer, geometries,
   * materials, textures) to prevent memory leaks.
   *
   * The cleanup sequence is symmetric with init():
   * 1. Remove the resize listener
   * 2. Remove the ESC key listener
   * 3. Stop the game loop
   * 4. Dispose the Input system
   * 5. Dispose the block highlight
   * 6. Dispose the particle system
   * 7. Dispose the hotbar
   * 8. Dispose the sky
   * 9. Dispose the ChunkMesh
   * 10. Dispose all UI screens
   * 11. Dispose the menu background scene
   * 12. Dispose the renderer
   * 13. Remove the canvas from the DOM
   */
  public dispose(): void {
    // Remove the resize listener.
    window.removeEventListener('resize', this.onResize);

    // Remove the ESC key listener.
    document.removeEventListener('keydown', this._handleEscapeKey);

    // Stop the game loop.
    this.stop();

    // Dispose of the Input system.
    if (this.input) {
      this.input.dispose();
    }

    // Dispose of the block highlight.
    if (this.blockHighlight) {
      this.blockHighlight.dispose();
    }

        // Dispose of the particle system.
    if (this.particleSystem) {
      this.particleSystem.dispose();
    }

    // Dispose of the crack overlay.
    if (this.crackOverlay) {
      this.crackOverlay.dispose();
    }

    // Dispose of the camera transition.
    if (this.cameraTransition) {
      this.cameraTransition.dispose();
    }

    // Dispose of the hotbar.
    if (this.hotbar) {
      this.hotbar.dispose();
    }

    // Dispose of the sky.
    if (this.sky) {
      this.sky.dispose();
    }

    // Dispose of the ChunkMesh.
    if (this.chunkMesh) {
      this.chunkMesh.dispose();
    }

    // Dispose of all UI screens.
    if (this.mainMenu) {
      this.mainMenu.dispose();
    }
    if (this.pauseMenu) {
      this.pauseMenu.dispose();
    }
    if (this.loadingScreen) {
      this.loadingScreen.dispose();
    }
    if (this.controlsScreen) {
      this.controlsScreen.dispose();
    }
    if (this.aboutScreen) {
      this.aboutScreen.dispose();
    }

    // Dispose of the menu background scene.
    this._disposeMenuScene();

    // Dispose of the renderer.
    if (this.renderer) {
      this.renderer.dispose();
    }

    // Remove the canvas from the DOM.
    if (this.renderer && this.renderer.domElement.parentElement === this.mountElement) {
      this.mountElement.removeChild(this.renderer.domElement);
    }
  }

  /**
   * Disposes of the menu background scene resources.
   *
   * This traverses the menu group and disposes all geometries, materials,
   * and textures held by the menu block meshes.
   */
  private _disposeMenuScene(): void {
    if (!this.menuGroup) {
      return;
    }

    // Traverse the menu group and dispose all resources.
    this.menuGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        // Dispose the geometry.
        child.geometry.dispose();

        // Dispose the material and its textures.
        const material = child.material as THREE.MeshLambertMaterial;
        if (material) {
          if (material.map) {
            material.map.dispose();
          }
          material.dispose();
        }
      }
    });

    // Remove the group from the menu scene.
    if (this.menuScene) {
      this.menuScene.remove(this.menuGroup);
    }
  }
}
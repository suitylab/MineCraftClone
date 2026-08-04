/**
 * Entry point for the Minecraft Clone application.
 * Bootstraps the Game instance and starts the main loop.
 */
import './style.css';
import { Game } from './core/Game';

/**
 * Initializes and starts the game.
 * Executes after DOM is ready (module scripts are deferred by default).
 */
function bootstrap(): void {
  try {
    const mountElement = document.getElementById('app');

    if (!mountElement) {
      throw new Error('Mount element #app not found in the DOM');
    }

        const game = new Game(mountElement);
    game.init();
    game.start();
  } catch (error) {
    console.error('Failed to initialize the game:', error);
  }
}

// Module scripts are deferred, so DOM is guaranteed to be parsed.
// Still guard for safety in case of script placement changes.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
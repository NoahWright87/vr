import { generateLevel } from './core/generator.ts';
self.onmessage = (event) => {
  try { self.postMessage({ level: generateLevel(event.data) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};

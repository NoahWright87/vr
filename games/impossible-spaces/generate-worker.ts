import { generateLevel } from './core/generator.ts';
import { generateRoomsFirst } from './core/rooms-first.ts';
self.onmessage = (event) => {
  try { self.postMessage({ level: event.data.generationStyle==='rooms-first'?generateRoomsFirst(event.data):generateLevel(event.data) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};

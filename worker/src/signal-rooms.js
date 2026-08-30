// Pure room-code logic for the hosted signaling relay (signal-hub.js).
// Kept separate from the Durable Object itself so it's testable
// without any Workers-runtime machinery.

// Excludes 0/O and 1/I — easy to misread out loud or off a screen.
export var ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeRoomCode (existingCodes) {
  existingCodes = existingCodes || new Set();
  var code;
  do {
    code = '';
    for (var i = 0; i < 4; i++) {
      code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
  } while (existingCodes.has(code));
  return code;
}

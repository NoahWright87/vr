// Pure room-code logic for the local signaling relay (signal-server.js).
// Kept separate from the server itself so it's testable without
// binding a real port.

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

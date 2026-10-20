# Shared interaction conventions

The watch and visor are consistent menu entry points across activities, like
Esc in a desktop game. They serve players and developers equally: gameplay,
runtime experiments, diagnostics, and recovery all belong there.

- Reuse the shared menu primitives rather than inventing an activity-specific
  menu system. Provide activity controls through both watch and visor, backed
  by the same settings and actions.
- Keep the main menu concise; put advanced experiments and debug controls in
  submenus. Do not remove useful tuning options merely to simplify the first UI.
- Expose relevant runtime settings, regeneration/restart, recovery actions,
  and diagnostic stats in these menus. Explain settings that require explicit
  regeneration; do not unexpectedly rebuild the world while adjusting a value.
- Keep menus accessible when gameplay is paused, tracking is recovering, or
  the player is stuck. Pause gameplay input and movement effects while menus
  are in use, without suppressing real headset tracking.
- Preserve the shared activation/input conventions across activities. When
  modifying an older activity, apply this convention to the affected flow;
  unrelated activities do not need an unsolicited rewrite.

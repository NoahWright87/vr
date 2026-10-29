# Comfort scrim: todo

- **Tune in a headset**, especially for smooth-locomotion sickness: the default
  size (35%) and darkness (75%), and whether Tunnel is the better default for
  "When moving". Common VR practice is a tunnel during motion; Sides was chosen
  as the default because it matches the menu wash it replaces.
- **Strength by speed.** Today it is on or off (faded). Many comfort vignettes
  grow with speed and turn rate; `readMotion` already returns both, so a
  "Grow with speed" toggle would only need `level` to target a fraction.
- **Retire locomotion's `comfortVignette` entirely** once nothing needs it.
  Punch Pop has its own speed-driven radial vignette (FEEL tab); fold it into
  this one so there is a single setting.
- **Screen-mode visor.** The visor menu drawn in `screen` mode sits at zero
  disparity like the scrim; check they still read well together.

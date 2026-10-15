// The lab uses the existing shared menu rows, navigation and wrist hardware.
const row = (key, label, values, labels, value, y) => {
  const normalized = values.split('|').map(v => Number.isFinite(Number(v)) ? String(Number(v)) : v).join('|');
  return `<a-entity menu-option="key: ${key}; label: ${label}; values: ${normalized}; labels: ${labels}; value: ${value}; width: .96; height: .16; font: sourcecodepro" position="0 ${y} 0"></a-entity>`;
};
const toggle = (key, label, value, y) => row(key, label, 'false|true', 'OFF|ON', value, y);
const text = (value, y, cls = '', color = '#bfcee2') => `<a-text font="sourcecodepro" class="${cls}" value="${value}" align="center" color="${color}" width="1.35" wrap-count="38" position="0 ${y} .01"></a-text>`;
const button = (value, label, y, cls = '') => `<a-entity class="pm-target" geometry="primitive: plane; width: .96; height: .16" material="color: #182f4a" menu-item="value: ${value}; label: ${label}" position="0 ${y} 0">${text(label, 0, cls)}</a-entity>`;
const page = (name, title, content, height = 2.1) => `<a-entity data-menu-page="${name}" visible="false"><a-plane width="1.12" height="${height}" color="#101827" position="0 ${.72 - height / 2} -.01"></a-plane><a-entity class="menu-chrome-slot" data-title="${title}" data-help="false" data-close="true" data-close-value="${name}-close" data-width="1.12" data-bar-y=".64"></a-entity>${content}</a-entity>`;

export function installExperimentMenus() {
  const template = document.querySelector('#watch-menu-template');
  if (!template || template.content.querySelector('[data-menu-page="experiments"]')) return;
  const panel = template.content.querySelector('.watch-menu-panel'), main = panel.querySelector('[data-menu-page="main"]');
  main.querySelector('a-plane').setAttribute('height', '2.6');
  main.querySelector('a-plane').setAttribute('position', '0 -.58 -.01');
  main.insertAdjacentHTML('beforeend', button('page-experiments', 'More experiments >', -1.65));
  panel.insertAdjacentHTML('beforeend',
    page('experiments', 'MORE EXPERIMENTS',
      button('page-arm', 'Arm swing: OFF >', .35, 'space-arm-link') +
      button('page-slide', 'Sliding: OFF >', .08, 'space-slide-link') +
      button('page-jump', 'Jumping: OFF >', -.19, 'space-jump-link') +
      button('page-scope', 'Binoculars: OFF >', -.46, 'space-scope-link') +
      text('New effects start OFF.\nStand normally, then calibrate.\nBinoculars return to your neck.', -.8) +
      button('space-calibrate-height', 'Calibrate standing height', -1.1)) +
    page('arm', 'ARM SWING',
      toggle('space-arm-enabled', 'Arm swing', false, .4) +
      row('space-arm-gain', 'Max boost', '1|1.5|2|3|4|6|8', '1.0x|1.5x|2.0x|3.0x|4.0x|6.0x|8.0x', 3, .16) +
      row('space-arm-speed', 'Full at', '.3|.5|1|1.5|2|3', '.3 m/s|.5 m/s|1 m/s|1.5 m/s|2 m/s|3 m/s', 1.5, -.08) +
      row('space-arm-stroke', 'Stroke', '.04|.06|.12|.2|.3|.4', '4 cm|6 cm|12 cm|20 cm|30 cm|40 cm', .12, -.32) +
      toggle('space-speed-lines', 'Speed lines', true, -.56) +
      text('Both arms swing front to back\nwhile walking. Multiplies speed gain.\nRequires two tracked XR grips.', -.85) + text('OFF', -1.12, 'space-arm-live', '#ffad54')) +
    page('slide', 'CROUCH SLIDING',
      toggle('space-slide-enabled', 'Sliding', false, .4) +
      row('space-slide-boost', 'Launch', '.5|1|1.5|2|3|5|8|10', '.5x|1x|1.5x|2x|3x|5x|8x|10x', 3, .16) +
      row('space-slide-loss-mode', 'Loss mode', 'percent|flat', 'Percent|Flat', 'percent', -.08) +
      row('space-slide-flat-loss', 'Flat loss', '0|.05|.1|.25|.5|1|2|4', '0 m/s/s|.05 m/s/s|.1 m/s/s|.25 m/s/s|.5 m/s/s|1 m/s/s|2 m/s/s|4 m/s/s', .5, -.32) +
      row('space-slide-percent-loss', 'Percent loss', '0|.001|.01|.05|.1|.3|.5|.75|.9', '0%/s|.1%/s|1%/s|5%/s|10%/s|30%/s|50%/s|75%/s|90%/s', .5, -.56) +
      text('Move, then duck within .6 s.\nDeeper duck = stronger launch.\nStand, open watch or disable to stop.', -.87) + text('OFF', -1.12, 'space-slide-live', '#ffad54') +
      button('space-reset-effects', 'Reset travel + rotation', -1.35), 2.3) +
    page('jump', 'JUMP GAIN',
      toggle('space-jump-enabled', 'Jumping', false, .4) +
      row('space-jump-boost', 'Forward', '.5|1|1.5|2|3|5|8|10', '.5x|1x|1.5x|2x|3x|5x|8x|10x', 1.5, .16) +
      row('space-jump-height', 'Height gain', '1|1.5|2|3|5|8|10', '1x|1.5x|2x|3x|5x|8x|10x', 3, -.08) +
      row('space-jump-rise', 'Rise', '.03|.05|.08|.12|.2|.3', '3 cm|5 cm|8 cm|12 cm|20 cm|30 cm', .08, -.32) +
      row('space-jump-loss', 'Speed loss', '0|.001|.01|.05|.1|.3|.5|.75|.9', '0%/s|.1%/s|1%/s|5%/s|10%/s|30%/s|50%/s|75%/s|90%/s', .3, -.56) +
      text('Height gain applies above Rise.\nHop in place or add forward carry.\nReal landing ends the jump.\nBoosted jumps open the roof.', -.88) + text('OFF', -1.17, 'space-jump-live', '#ffad54') +
      button('space-calibrate-height', 'Calibrate standing height', -1.42) +
      button('space-reset-effects', 'Reset travel + rotation', -1.65), 2.5) +
    page('scope', 'BINOCULARS',
      toggle('space-scope-enabled', 'Binoculars', false, .4) +
      toggle('space-scope-stabilize', 'Stabilize', true, .16) +
      row('space-scope-zoom', 'Zoom', '2|4|6|8', '2x|4x|6x|8x', 4, -.08) +
      row('space-scope-rotation', 'Rotation lag', '0|.05|.1|.15|.25|.4|.8', '0 s|.05 s|.1 s|.15 s|.25 s|.4 s|.8 s', .15, -.32) +
      row('space-scope-position', 'Position lag', '0|.05|.1|.15|.25|.4|.8', '0 s|.05 s|.1 s|.15 s|.25 s|.4 s|.8 s', .15, -.56) +
      text('Grab from chest, raise to eyes.\nTrigger: test shot through reticle.\nDesktop: B grab, right-click aim.\nWindows on the right wall.', -.88) +
      text('Raw 0/0 | Damped 0/0', -1.15, 'space-scope-live', '#ffad54') +
      button('space-reset-targets', 'Reset target scores', -1.4), 2.4));
}

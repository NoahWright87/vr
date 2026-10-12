// ============================================================
// The Action Lab's visor page. Stations add their own rows through
// addLabRows(); everything tunable on the page is under Tuning (the
// tunables registry fills it), and Debug has the HUD readouts, draw
// channels and the action log.
// ============================================================

import { registerVisorPage } from '../../common/visor-page.js';
import { debugMenuItem, tuningMenuItem } from '../../common/action-debug.js';

var stationRows = [];

// rows: an array of crossbar items, or a function returning one.
export function addLabRows(rows) {
  stationRows.push(rows);
}

registerVisorPage('visor', {
  title: 'ACTION LAB',
  items: function () {
    var own = [];
    stationRows.forEach(function (rows) {
      own = own.concat(typeof rows === 'function' ? rows() : rows);
    });
    return own.concat([tuningMenuItem(), debugMenuItem()]);
  },
});

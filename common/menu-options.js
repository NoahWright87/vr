export function parseMenuOptions(valuesText, labelsText) {
  var values = String(valuesText || '').split('|').map(function (value) { return value.trim(); }).filter(Boolean);
  var labels = String(labelsText || '').split('|').map(function (label) { return label.trim(); });
  return values.map(function (value, index) {
    return { value: value, label: labels[index] || value };
  });
}

export function cycleMenuOptionIndex(length, currentIndex, delta) {
  if (!length) return -1;
  return (currentIndex + delta % length + length) % length;
}

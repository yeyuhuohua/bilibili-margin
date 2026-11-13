/** Compile CSS radii once; no DOM scanning, masks or per-frame JavaScript. */
export function transformRadii(code) {
  return code.replace(/(border(?:-(?:top|bottom)-(?:left|right))?-radius\s*:\s*)([^;}"'`\n!]+)(!\s*important\b)?/g,
    (_match, property, value, important = '', offset) => {
      const scaled = value.replace(/(^|[\s(,])(\d*\.?\d+)(px|em)\b/g,
        (_number, prefix, n, unit) => Number(n) === 0 ? `${prefix}${n}${unit}` : `${prefix}calc(${n}${unit}*var(--margin-rk,1))`);
      const keyword = value.trim();
      let shape;
      if (/^(inherit|initial|unset|revert|revert-layer)$/.test(keyword)) shape = keyword;
      else if (value.includes('${')) return property + scaled + important;
      else {
        const capsule = value.includes('%') || [...value.matchAll(/(?:^|[\s(,])(\d*\.?\d+)(?:px|em)\b/g)].some(match => Number(match[1]) >= 99);
        shape = capsule ? 'round' : 'squircle';
      }
      const shapeProperty = property.replace(/^border/, 'corner').replace(/-radius\s*:\s*$/, '-shape:');
      const block = code.slice(code.lastIndexOf('{', offset) + 1, code.indexOf('}', offset) === -1 ? code.length : code.indexOf('}', offset));
      // CSS optimizers may reorder properties; explicit shapes still take precedence.
      if (new RegExp(`\\b${shapeProperty.slice(0, -1)}\\s*:`).test(block)) return property + scaled + important;
      return `${property}${scaled}${important};${shapeProperty}${shape}${important}`;
    });
}

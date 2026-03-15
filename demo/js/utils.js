export function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

export function countNodes(tree) {
  let dirs = 0, images = 0;
  function walk(node) {
    for (const sub of node.subdirectories || []) { dirs++; walk(sub); }
    images += (node.images || []).length;
  }
  walk(tree);
  return { dirs, images };
}

export function countProps(props) {
  let count = 0;
  for (const p of props) {
    count++;
    if (p.children) count += countProps(p.children);
  }
  return count;
}

export function formatPropValue(prop) {
  switch (prop.type) {
    case 'Short': case 'Int': case 'Long': return String(prop.value);
    case 'Float': case 'Double': return Number(prop.value).toFixed(4);
    case 'String': return `"${prop.value}"`;
    case 'UOL': return `-> ${prop.value}`;
    case 'Vector': return `(${prop.x}, ${prop.y})`;
    case 'Canvas': return `${prop.width}x${prop.height} fmt=${prop.format} [${formatBytes(prop.dataLength)}]`;
    case 'Sound': return `${prop.duration_ms}ms [${formatBytes(prop.dataLength)}]`;
    case 'Video': {
      let desc = `type=${prop.videoType} [${formatBytes(prop.dataLength)}]`;
      if (prop.mcv) desc += ` ${prop.mcv.width}x${prop.mcv.height} ${prop.mcv.frameCount}f`;
      return desc;
    }
    case 'Lua': case 'RawData': return `[${formatBytes(prop.dataLength)}]`;
    case 'Null': return 'null';
    default: return '';
  }
}

export function escapeField(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

export function splitFields(line: string): string[] | null {
  const fields: string[] = [];
  let current = '';
  for (let i = 0; i < line.length; i++) {
    const char = line[i] as string;
    if (char === '|') {
      fields.push(current);
      current = '';
    } else if (char === '\\') {
      const next = line[++i];
      if (next === '\\' || next === '|') current += next;
      else if (next === 'n') current += '\n';
      else if (next === 'r') current += '\r';
      else return null;
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

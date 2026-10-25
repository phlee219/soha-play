// Voice clip names derived from content.json. Shared by app.js and sw.js;
// tools/make_audio.py must produce the same names.
function clipNames(c) {
  const n = [];
  for (const k in c.phrases) n.push('p-' + k);
  for (const a of c.animals) n.push(`a-${a.id}-name`, `a-${a.id}-sound`, `a-${a.id}-where`);
  for (const w of c.words) n.push(`w-${w.id}-name`, `w-${w.id}-where`);
  return n;
}

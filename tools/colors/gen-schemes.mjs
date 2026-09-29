// Generates the colour schemes at the end of web/app.css (Settings → Colour).
// One-off tool, not a project dependency: in a scratch folder run
//   npm install @material/material-color-utilities@0.4.0
// then run this file with tsx from there (the package's imports need tsx), and paste the output into web/app.css.
import { Hct, SchemeFidelity, MaterialDynamicColors as M, hexFromArgb, argbFromHex } from '@material/material-color-utilities';
const seeds = { red: '#d32f2f', orange: '#f57c00', green: '#2e7d32', blue: '#1565c0', teal: '#00897b' };
const roles = ['primary','onPrimary','primaryContainer','onPrimaryContainer','secondary','onSecondary','secondaryContainer','onSecondaryContainer','tertiary','onTertiary','tertiaryContainer','onTertiaryContainer','error','onError','errorContainer','onErrorContainer','surface','onSurface','onSurfaceVariant','surfaceContainerLowest','surfaceContainerLow','surfaceContainer','surfaceContainerHigh','surfaceContainerHighest','outline','outlineVariant','inverseSurface','inverseOnSurface','inversePrimary'];
const kebab = (s) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
const block = (seed, dark, indent) => {
  const s = new SchemeFidelity(Hct.fromInt(argbFromHex(seed)), dark, 0);
  return roles.map((r) => `${indent}--md-${kebab(r)}: ${hexFromArgb(M[r].getArgb(s))};`).join('\n');
};
let out = `/* ------------------------------------------------------------ colour schemes (Settings → Colour)
   Generated with Google's material-color-utilities 0.4.0 (SchemeFidelity: stays close to the seed colour)
   from each seed; Purple is M3's baseline scheme above. Dark rules outrank light ones by specificity. */\n`;
for (const [name, seed] of Object.entries(seeds)) {
  out += `\n/* ${name[0].toUpperCase() + name.slice(1)}, seed ${seed} */\n`;
  out += `:root[data-color="${name}"] {\n${block(seed, false, '  ')}\n}\n`;
  out += `:root[data-color="${name}"][data-theme="dark"] {\n${block(seed, true, '  ')}\n}\n`;
  out += `@media (prefers-color-scheme: dark) {\n  :root[data-color="${name}"]:not([data-theme="light"]) {\n${block(seed, true, '    ')}\n  }\n}\n`;
}
process.stdout.write(out);

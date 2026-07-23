import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const media = join(root, 'media');
const desktop = join(root, 'dist-pet');

copyFileSync(join(media, 'pet-binding.css'), join(desktop, 'pet-binding.css'));
copyFileSync(join(media, 'pet-binding.js'), join(desktop, 'pet-binding.js'));
copyFileSync(join(media, 'pet-binding-desktop.css'), join(desktop, 'pet-binding-desktop.css'));
copyFileSync(join(media, 'pet-binding-desktop.js'), join(desktop, 'pet-binding-desktop.js'));
copyFileSync(join(media, 'pet-bubble.css'), join(desktop, 'pet-bubble.css'));
copyFileSync(join(root, 'src-tauri', 'icons', 'icon.png'), join(desktop, 'cc-pet-icon.png'));

const template = readFileSync(join(media, 'pet-binding-desktop.html'), 'utf8');
const desktopHtml = template
  .replace('${cspMeta}', '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; img-src \'self\' data:; style-src \'self\' \'unsafe-inline\'; script-src \'self\';">')
  .replace('${cssUri}', 'pet-binding-desktop.css')
  .replaceAll('${appIconUri}', 'cc-pet-icon.png')
  .replace('${hostScript}', '<script src="settings-host.js"></script>')
  .replace('${desktopJsUri}', 'pet-binding-desktop.js')
  .replace('${nonceAttribute}', '')
  .replace('${jsUri}', 'pet-binding.js');
writeFileSync(join(desktop, 'settings.html'), desktopHtml, 'utf8');

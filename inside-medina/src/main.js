const params = new URLSearchParams(location.search);
const canvas = document.getElementById('c');
// dev views (asset sheet, exporter, texture and material previews) are stripped from the artifact build
const dev = !import.meta.env.VITE_ARTIFACT && (params.get('dev') || location.hash === '#assets');
if (dev && params.get('dev') === 'export') {
  import('./dev/export.js').then((m) => m.runExport());
} else if (dev && params.get('dev') === 'textures') {
  import('./dev/texview.js').then((m) => m.runTextureView(canvas));
} else if (dev && (params.get('dev') === 'assets' || location.hash === '#assets')) {
  import('./dev/gallery.js').then((m) => m.runGallery(canvas, { focus: params.get('focus') }));
} else if (dev && params.get('dev') === 'materials') {
  import('./dev/matpreview.js').then((m) => m.runMaterialPreview(canvas));
} else {
  import('./game/boot.js').then((m) => m.boot(canvas, params));
}

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('c');
if (params.get('dev') === 'export') {
  import('./dev/export.js').then((m) => m.runExport());
} else if (params.get('dev') === 'textures') {
  import('./dev/texview.js').then((m) => m.runTextureView(canvas));
} else if (params.get('dev') === 'materials') {
  import('./dev/matpreview.js').then((m) => m.runMaterialPreview(canvas));
} else {
  import('./game/boot.js').then((m) => m.boot(canvas, params));
}

// Trailz desktop shell: serves the built web app from a private app:// origin so data in
// IndexedDB stays put between launches (the origin never changes), and works fully offline.
const { app, BrowserWindow, protocol, net, shell, Menu } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])

const DIST = path.join(__dirname, '..', 'dist')

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 380,
    minHeight: 560,
    title: 'Trailz',
    backgroundColor: '#f3eee3',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
  })
  // Links to maps/websites open in the normal browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.loadURL('app://spoor/index.html')
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url)
    let file = path.normalize(path.join(DIST, decodeURIComponent(pathname)))
    if (!file.startsWith(DIST)) return new Response('Not found', { status: 404 })
    if (pathname === '/' || pathname === '') file = path.join(DIST, 'index.html')
    return net.fetch(pathToFileURL(file).toString())
  })
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())

// Let the page ask for location (used for the map dot and live sharing).
app.whenReady().then(() => {
  const { session } = require('electron')
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(['geolocation', 'notifications'].includes(permission)))
})

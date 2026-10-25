'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const clean = (t) => ({ id: t.id, album: t.album, n: t.n, title: t.title, artist: t.artist, sec: t.sec, file: t.file, albumTitle: t.albumTitle });

contextBridge.exposeInMainWorld('api', {
  catalog: () => ipcRenderer.invoke('catalog:get'),
  refreshCatalog: () => ipcRenderer.invoke('catalog:refresh'),
  mediaUrl: (t) => ipcRenderer.invoke('media:url', clean(t)),
  prefetch: (list) => ipcRenderer.invoke('media:prefetch', (Array.isArray(list) ? list : [list]).filter(Boolean).map(clean)),
  coverUrl: (fileId) => ipcRenderer.invoke('cover:url', fileId),
  artwork: (rel) => ipcRenderer.invoke('cover:data', rel),
  downloads: () => ipcRenderer.invoke('dl:list'),
  download: (list) => ipcRenderer.invoke('dl:start', list.map(clean)),
  removeDownloads: (list) => ipcRenderer.invoke('dl:remove', list.map(clean)),
  lyrics: (t) => ipcRenderer.invoke('lyrics:get', clean(t)),
  version: () => ipcRenderer.invoke('app:version'),
  weather: () => ipcRenderer.invoke('weather:get'),
  reportDuration: (file, sec) => ipcRenderer.send('track:sec', { file: String(file || ''), sec: Number(sec) }),
  onMeta: (fn) => {
    const h = (_e, p) => fn(p);
    ipcRenderer.on('catalog:meta', h);
    return () => ipcRenderer.removeListener('catalog:meta', h);
  },
  win: {
    minimize: () => ipcRenderer.send('win:min'),
    toggleMaximize: () => ipcRenderer.send('win:max'),
    close: () => ipcRenderer.send('win:close'),
    state: () => ipcRenderer.invoke('win:state'),
    onState: (fn) => {
      const h = (_e, p) => fn(p);
      ipcRenderer.on('win:state', h);
      return () => ipcRenderer.removeListener('win:state', h);
    }
  },
  onDownload: (fn) => {
    const h = (_e, p) => fn(p);
    ipcRenderer.on('dl:progress', h);
    return () => ipcRenderer.removeListener('dl:progress', h);
  }
});

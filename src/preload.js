'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('blindspot', {
  getSettings: call('settings:get'),
  saveSettings: call('settings:save'),
  listPulls: call('pulls:list'),
  findGaps: call('gaps:find'),
  copyReport: call('gaps:copy'),
  postReport: call('gaps:post'),
  openExternal: call('open:external')
});

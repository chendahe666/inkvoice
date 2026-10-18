const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('inkvoiceOverlay',{onState(fn){ipcRenderer.on('inkvoice:state',(_e,value)=>fn(value));}});

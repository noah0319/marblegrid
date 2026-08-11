import { contextBridge } from 'electron'
import { SERVER_PORT } from '../shared/constants.ts'

contextBridge.exposeInMainWorld('marbleGrid', {
  serverPort: SERVER_PORT
})

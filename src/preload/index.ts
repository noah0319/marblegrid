import { contextBridge } from 'electron'
import { SERVER_PORT } from '../shared/constants'

contextBridge.exposeInMainWorld('marbleGrid', {
  serverPort: SERVER_PORT
})
